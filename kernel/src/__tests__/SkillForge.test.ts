import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { SkillForge } from '../SkillForge.js';
import type { SkillForgeCreateParams, SkillPermissionManifest } from '@aether/shared';

// ---------------------------------------------------------------------------
// Mocks — only mock modules that cause side effects or need control
// ---------------------------------------------------------------------------

// Mock logger — lightweight, no side effects
vi.mock('../logger.js', () => ({
  errMsg: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

// Fetch mock for ClawHub tests
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ---------------------------------------------------------------------------
// Helper: create mock dependencies injected into the SkillForge constructor
// ---------------------------------------------------------------------------

function createMockDeps() {
  const bus = new EventBus();

  // Mock StateStore — provide the `db` property (accessed via `(this.state as any).db`)
  // and the proposal/embedding helper methods.
  const dbRunMock = vi.fn();
  const dbAllMock = vi.fn(() => []);
  const dbGetMock = vi.fn();
  const dbPrepareMock = vi.fn(() => ({
    run: dbRunMock,
    all: dbAllMock,
    get: dbGetMock,
  }));
  const dbExecMock = vi.fn();

  const state = {
    db: {
      exec: dbExecMock,
      prepare: dbPrepareMock,
    },
    insertProposal: vi.fn(),
    getProposal: vi.fn(),
    updateProposalStatus: vi.fn(),
    getProposalsByStatus: vi.fn(() => []),
    getAllProposals: vi.fn(() => []),
    upsertSkillEmbedding: vi.fn(),
    getAllSkillEmbeddings: vi.fn(() => []),
  } as any;

  // Mock PluginRegistryManager
  const pluginRegistry = {
    search: vi.fn(() => []),
    list: vi.fn(() => []),
    get: vi.fn(() => null),
    install: vi.fn(),
    uninstall: vi.fn(),
    incrementUsage: vi.fn(),
    addQualityRating: vi.fn(() => ({ avg_quality: 4.0, flagged: false })),
  } as any;

  // Mock OpenClawAdapter — importSkill succeeds and returns a valid manifest
  const openClaw = {
    importSkill: vi.fn(async () => ({
      manifest: {
        id: 'openclaw-skill-test',
        name: 'test-skill',
        description: 'A test skill',
        version: '1.0.0',
        author: 'test',
        category: 'tools',
        icon: 'Plug',
        tools: [],
        keywords: [],
      },
      instructions: '# Test\nDo something',
      warnings: [],
      dependenciesMet: true,
      sourcePath: '/tmp/test/SKILL.md',
    })),
    removeImport: vi.fn(),
  } as any;

  // Mock ContainerManager — SkillForge stores it but does not call methods
  // directly in the methods under test
  const containers = {} as any;

  return {
    bus,
    state,
    pluginRegistry,
    openClaw,
    containers,
    // Expose internal mock handles for targeted assertions
    _dbMocks: { exec: dbExecMock, prepare: dbPrepareMock, run: dbRunMock, all: dbAllMock },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillForge', () => {
  let forge: SkillForge;
  let bus: EventBus;
  let state: any;
  let pluginRegistry: any;
  let openClaw: any;
  let containers: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    const deps = createMockDeps();
    bus = deps.bus;
    state = deps.state;
    pluginRegistry = deps.pluginRegistry;
    openClaw = deps.openClaw;
    containers = deps.containers;
    forge = new SkillForge(bus, state, pluginRegistry, openClaw, containers);
  });

  // -----------------------------------------------------------------------
  // init()
  // -----------------------------------------------------------------------

  describe('init()', () => {
    it('creates the skill_versions table and emits initialized event', async () => {
      const events: any[] = [];
      bus.on('skillforge.initialized', (d: any) => events.push(d));

      await forge.init();

      expect(state.db.exec).toHaveBeenCalledOnce();
      expect(state.db.exec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS skill_versions'),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ skillCount: 0 }));
    });

    it('loads existing versions from SQLite on init', async () => {
      // Override the all() mock to return version rows
      state.db.prepare = vi.fn(() => ({
        run: vi.fn(),
        all: vi.fn(() => [
          {
            skill_id: 'forge-existing',
            version: 1,
            content: 'test content',
            created_by: 'agent-1',
            created_at: 1000,
          },
        ]),
        get: vi.fn(),
      }));

      await forge.init();

      const versions = await forge.listVersions('forge-existing');
      expect(versions).toHaveLength(1);
      expect(versions[0]).toEqual(
        expect.objectContaining({
          version: 1,
          content: 'test content',
          created_by: 'agent-1',
        }),
      );
    });

    it('loads existing embeddings from StateStore on init', async () => {
      state.getAllSkillEmbeddings.mockReturnValue([
        {
          skill_id: 'forge-embed-test',
          embedding: JSON.stringify([0.5, 0.3, 0.1]),
          updated_at: 1000,
        },
      ]);

      await forge.init();

      expect(state.getAllSkillEmbeddings).toHaveBeenCalledOnce();
    });

    it('skips corrupted embedding rows without throwing', async () => {
      state.getAllSkillEmbeddings.mockReturnValue([
        { skill_id: 'bad', embedding: 'not-json', updated_at: 1000 },
        {
          skill_id: 'good',
          embedding: JSON.stringify([1, 2, 3]),
          updated_at: 1000,
        },
      ]);

      // Should not throw
      await expect(forge.init()).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // scoreRisk()
  // -----------------------------------------------------------------------

  describe('scoreRisk()', () => {
    it('returns "minimal" when no permissions provided', () => {
      expect(forge.scoreRisk()).toBe('minimal');
      expect(forge.scoreRisk(undefined)).toBe('minimal');
    });

    it('returns "minimal" for empty permissions object', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'testing',
      };
      expect(forge.scoreRisk(permissions)).toBe('minimal');
    });

    it('returns "low" for read-only filesystem access', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'read files',
        filesystem: ['read:./data'],
      };
      expect(forge.scoreRisk(permissions)).toBe('low');
    });

    it('returns "low" for env variable access', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'env check',
        env: ['API_KEY'],
      };
      expect(forge.scoreRisk(permissions)).toBe('low');
    });

    it('returns "moderate" for write filesystem access', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'write files',
        filesystem: ['write:./output'],
      };
      expect(forge.scoreRisk(permissions)).toBe('moderate');
    });

    it('returns "moderate" for network access', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'network',
        network: ['api.example.com'],
      };
      expect(forge.scoreRisk(permissions)).toBe('moderate');
    });

    it('returns "high" for exec permission', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'run scripts',
        exec: ['node'],
      };
      expect(forge.scoreRisk(permissions)).toBe('high');
    });

    it('returns "high" for credential access', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'use credentials',
        sensitive_data: { credentials: true },
      };
      expect(forge.scoreRisk(permissions)).toBe('high');
    });

    it('returns "critical" when exec and credentials are both present', () => {
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'dangerous',
        exec: ['bash'],
        sensitive_data: { credentials: true },
      };
      expect(forge.scoreRisk(permissions)).toBe('critical');
    });

    it('prefers high-risk indicators over moderate ones', () => {
      // exec (high) + network (moderate) => high wins
      const permissions: SkillPermissionManifest = {
        version: 1,
        declared_purpose: 'mixed',
        exec: ['node'],
        network: ['example.com'],
      };
      expect(forge.scoreRisk(permissions)).toBe('high');
    });
  });

  // -----------------------------------------------------------------------
  // discover()
  // -----------------------------------------------------------------------

  describe('discover()', () => {
    it('searches local plugin registry when source=all', async () => {
      pluginRegistry.search.mockReturnValue([
        {
          id: 'plugin-a',
          enabled: true,
          manifest: {
            name: 'Plugin A',
            description: 'First plugin',
            keywords: ['test'],
          },
        },
      ]);
      pluginRegistry.list.mockReturnValue([]);

      // Stub ClawHub to return nothing
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      const results = await forge.discover('test');

      expect(pluginRegistry.search).toHaveBeenCalledWith('test');
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          skill_id: 'plugin-a',
          name: 'Plugin A',
          source: 'local',
          installed: true,
        }),
      );
    });

    it('does not call ClawHub when source=local', async () => {
      pluginRegistry.search.mockReturnValue([]);
      pluginRegistry.list.mockReturnValue([]);

      await forge.discover('test', 'local');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deduplicates results between search and list', async () => {
      const pluginEntry = {
        id: 'plugin-dup',
        enabled: true,
        manifest: {
          name: 'Dup Plugin',
          description: 'duplicated',
          keywords: ['test'],
        },
      };
      pluginRegistry.search.mockReturnValue([pluginEntry]);
      pluginRegistry.list.mockReturnValue([pluginEntry]);

      const results = await forge.discover('test', 'local');

      expect(results).toHaveLength(1);
    });

    it('matches keywords from the plugin list', async () => {
      pluginRegistry.search.mockReturnValue([]);
      pluginRegistry.list.mockReturnValue([
        {
          id: 'kw-match',
          enabled: false,
          manifest: {
            name: 'Something',
            description: 'unrelated',
            keywords: ['image-processor'],
          },
        },
      ]);

      const results = await forge.discover('image', 'local');

      expect(results).toHaveLength(1);
      expect(results[0].skill_id).toBe('kw-match');
    });

    it('respects limit parameter', async () => {
      pluginRegistry.search.mockReturnValue([
        { id: 'a', enabled: true, manifest: { name: 'A', description: 'a', keywords: [] } },
        { id: 'b', enabled: true, manifest: { name: 'B', description: 'b', keywords: [] } },
        { id: 'c', enabled: true, manifest: { name: 'C', description: 'c', keywords: [] } },
      ]);
      pluginRegistry.list.mockReturnValue([]);

      const results = await forge.discover('test', 'local', 2);

      expect(results).toHaveLength(2);
    });

    it('emits skillforge.discover.completed event', async () => {
      pluginRegistry.search.mockReturnValue([]);
      pluginRegistry.list.mockReturnValue([]);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      const events: any[] = [];
      bus.on('skillforge.discover.completed', (d: any) => events.push(d));

      await forge.discover('testing', 'all', 5);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          query: 'testing',
          source: 'all',
          resultCount: 0,
        }),
      );
    });

    it('includes ClawHub results when source=clawhub', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            {
              id: 'hub-skill-1',
              name: 'Hub Skill',
              description: 'From ClawHub',
              author: 'community',
              downloads: 100,
              rating: 4.5,
              tags: ['test'],
              updated_at: '2025-01-01',
            },
          ],
        }),
      });

      const results = await forge.discover('test', 'clawhub');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          skill_id: 'hub-skill-1',
          source: 'clawhub',
          installed: false,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // searchClawHub()
  // -----------------------------------------------------------------------

  describe('searchClawHub()', () => {
    it('returns skills from ClawHub API on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [{ id: 's1', name: 'Skill 1', description: 'd' }],
        }),
      });

      const results = await forge.searchClawHub('query');

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('s1');
    });

    it('builds the correct URL with encoded query and limit', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      await forge.searchClawHub('image processor', 5);

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('q=image%20processor');
      expect(url).toContain('limit=5');
    });

    it('returns empty array on rate limit (429)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 429 });

      const results = await forge.searchClawHub('query');

      expect(results).toEqual([]);
    });

    it('returns empty array on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('network error'));

      const results = await forge.searchClawHub('query');

      expect(results).toEqual([]);
    });

    it('caches results and reuses them on second identical call', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [{ id: 'cached', name: 'Cached Skill' }],
        }),
      });

      await forge.searchClawHub('same-query', 10);
      const results = await forge.searchClawHub('same-query', 10);

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('cached');
    });

    it('returns empty array on non-429 API error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      const results = await forge.searchClawHub('query');

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // fetchClawHubSkill()
  // -----------------------------------------------------------------------

  describe('fetchClawHubSkill()', () => {
    it('returns skill content on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => '---\nname: test\n---\n# Test Skill',
      });

      const content = await forge.fetchClawHubSkill('my-skill');

      expect(content).toBe('---\nname: test\n---\n# Test Skill');
    });

    it('returns null when skill is not found', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });

      const content = await forge.fetchClawHubSkill('missing');

      expect(content).toBeNull();
    });

    it('returns null on network error', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));

      const content = await forge.fetchClawHubSkill('broken');

      expect(content).toBeNull();
    });

    it('caches fetched content for subsequent calls', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: async () => 'cached-content',
      });

      await forge.fetchClawHubSkill('skill-id');
      const second = await forge.fetchClawHubSkill('skill-id');

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(second).toBe('cached-content');
    });
  });

  // -----------------------------------------------------------------------
  // getClawHubPopular()
  // -----------------------------------------------------------------------

  describe('getClawHubPopular()', () => {
    it('returns popular skills from ClawHub', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [{ id: 'pop1', name: 'Popular' }],
        }),
      });

      const results = await forge.getClawHubPopular();

      expect(results).toHaveLength(1);
    });

    it('includes category in URL when provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ skills: [] }),
      });

      await forge.getClawHubPopular('tools', 5);

      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('category=tools');
      expect(calledUrl).toContain('limit=5');
    });

    it('returns empty array on error', async () => {
      fetchMock.mockRejectedValue(new Error('fail'));

      const results = await forge.getClawHubPopular();

      expect(results).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // install()
  // -----------------------------------------------------------------------

  describe('install()', () => {
    it('installs a local skill via OpenClaw adapter', async () => {
      const result = await forge.install('my-skill', 'local', 'agent-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('installed successfully');
      expect(openClaw.importSkill).toHaveBeenCalledWith('my-skill');
    });

    it('emits skillforge.skill.installed event on success', async () => {
      const events: any[] = [];
      bus.on('skillforge.skill.installed', (d: any) => events.push(d));

      await forge.install('my-skill', 'local', 'agent-1');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          skillId: 'openclaw-skill-test',
          name: 'test-skill',
          agentUid: 'agent-1',
        }),
      );
    });

    it('stores version record after successful install', async () => {
      await forge.install('my-skill', 'local', 'agent-1');

      // storeVersion calls db.prepare(...).run(...)
      expect(state.db.prepare).toHaveBeenCalled();
    });

    it('computes and stores embedding for installed skill', async () => {
      await forge.install('my-skill', 'local', 'agent-1');

      expect(state.upsertSkillEmbedding).toHaveBeenCalledWith(
        'openclaw-skill-test',
        expect.any(Array),
      );
    });

    it('emits install.failed and returns failure on import error', async () => {
      openClaw.importSkill.mockRejectedValue(new Error('parse error'));
      const events: any[] = [];
      bus.on('skillforge.install.failed', (d: any) => events.push(d));

      const result = await forge.install('bad-skill', 'local');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Install failed');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          skillId: 'bad-skill',
          error: 'parse error',
        }),
      );
    });

    it('returns error for unsupported source', async () => {
      const result = await forge.install('skill', 'ftp');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not yet supported');
    });

    it('returns failure when clawhub skill is not found', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });

      const result = await forge.install('hub-skill', 'clawhub');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found on ClawHub');
    });
  });

  // -----------------------------------------------------------------------
  // create()
  // -----------------------------------------------------------------------

  describe('create()', () => {
    const baseParams: SkillForgeCreateParams = {
      name: 'my-new-skill',
      description: 'A brand new skill',
      instructions: 'Follow these steps to do things',
    };

    it('returns success with a forge- prefixed skillId', async () => {
      const result = await forge.create(baseParams, 'agent-1');

      expect(result.success).toBe(true);
      expect(result.skillId).toBeDefined();
      expect(result.skillId!.startsWith('forge-')).toBe(true);
      expect(result.message).toContain('created successfully');
    });

    it('emits skillforge.skill.created event with risk level', async () => {
      const events: any[] = [];
      bus.on('skillforge.skill.created', (d: any) => events.push(d));

      await forge.create(baseParams, 'agent-1');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          name: 'my-new-skill',
          risk: 'minimal',
          agentUid: 'agent-1',
        }),
      );
    });

    it('calls openClaw.importSkill during creation pipeline', async () => {
      await forge.create(baseParams, 'agent-1');

      expect(openClaw.importSkill).toHaveBeenCalledOnce();
    });

    it('stores version 1 after successful creation', async () => {
      const result = await forge.create(baseParams, 'agent-1');
      const versions = await forge.listVersions(result.skillId!);

      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].created_by).toBe('agent-1');
    });

    it('computes and stores embedding for the new skill', async () => {
      await forge.create(baseParams, 'agent-1');

      expect(state.upsertSkillEmbedding).toHaveBeenCalledWith(
        expect.stringContaining('forge-'),
        expect.any(Array),
      );
    });

    it('scores risk as "high" when permissions include exec', async () => {
      const events: any[] = [];
      bus.on('skillforge.skill.created', (d: any) => events.push(d));

      const params: SkillForgeCreateParams = {
        ...baseParams,
        permissions: {
          version: 1,
          declared_purpose: 'execute',
          exec: ['python'],
        },
      };

      await forge.create(params, 'agent-1');

      expect(events[0]).toEqual(expect.objectContaining({ risk: 'high' }));
    });

    it('emits create.failed event when import throws', async () => {
      openClaw.importSkill.mockRejectedValue(new Error('import boom'));
      const events: any[] = [];
      bus.on('skillforge.create.failed', (d: any) => events.push(d));

      const result = await forge.create(baseParams, 'agent-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Create failed');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          name: 'my-new-skill',
          error: 'import boom',
          agentUid: 'agent-1',
        }),
      );
    });

    describe('rate limiting', () => {
      it('enforces per-agent rate limit of 5 creates per hour', async () => {
        // SKILLFORGE_MAX_CREATES_PER_HOUR is 5
        for (let i = 0; i < 5; i++) {
          const r = await forge.create({ ...baseParams, name: `skill-${i}` }, 'agent-rate');
          expect(r.success).toBe(true);
        }

        // 6th call by the same agent should be rejected
        const result = await forge.create({ ...baseParams, name: 'skill-6' }, 'agent-rate');

        expect(result.success).toBe(false);
        expect(result.message).toContain('Rate limit exceeded');
      });

      it('tracks rate limits independently per agent', async () => {
        // Exhaust agent-A's quota
        for (let i = 0; i < 5; i++) {
          await forge.create({ ...baseParams, name: `a-${i}` }, 'agent-A');
        }

        // agent-B should still be able to create
        const result = await forge.create(baseParams, 'agent-B');
        expect(result.success).toBe(true);
      });
    });

    describe('sandbox testing', () => {
      it('succeeds when test_input is provided without test_expected', async () => {
        const params: SkillForgeCreateParams = {
          ...baseParams,
          test_input: 'some input',
        };

        const result = await forge.create(params, 'agent-1');

        expect(result.success).toBe(true);
      });

      it('handles test_expected that is already in the instructions', async () => {
        const params: SkillForgeCreateParams = {
          ...baseParams,
          instructions: 'Follow these steps to do things',
          test_input: 'testing',
          test_expected: 'follow these steps',
        };

        const result = await forge.create(params, 'agent-1');

        expect(result.success).toBe(true);
      });
    });
  });

  // -----------------------------------------------------------------------
  // compose()
  // -----------------------------------------------------------------------

  describe('compose()', () => {
    it('fails when a component skill does not exist', async () => {
      pluginRegistry.get.mockReturnValue(null);

      const result = await forge.compose(
        'composite',
        'desc',
        [{ skill_id: 'missing-skill' }],
        'agent-1',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('Component skill not found');
      expect(result.message).toContain('missing-skill');
    });

    it('creates a composite skill when all components exist', async () => {
      pluginRegistry.get.mockReturnValue({
        id: 'skill-1',
        manifest: { name: 'Skill 1' },
      });

      const events: any[] = [];
      bus.on('skillforge.skill.composed', (d: any) => events.push(d));

      const result = await forge.compose(
        'composed-name',
        'composed desc',
        [{ skill_id: 'skill-1' }, { skill_id: 'skill-1', input_mapping: 'output.data' }],
        'agent-1',
      );

      expect(result.success).toBe(true);
      expect(result.skillId).toBeDefined();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          name: 'composed-name',
          componentCount: 2,
          agentUid: 'agent-1',
        }),
      );
    });

    it('fails early on the first missing component', async () => {
      pluginRegistry.get
        .mockReturnValueOnce({ id: 'a', manifest: { name: 'A' } })
        .mockReturnValueOnce(null);

      const result = await forge.compose(
        'partial',
        'desc',
        [{ skill_id: 'a' }, { skill_id: 'b' }],
        'agent-1',
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('b');
    });
  });

  // -----------------------------------------------------------------------
  // remove()
  // -----------------------------------------------------------------------

  describe('remove()', () => {
    it('calls db.prepare with UPDATE to set deleted_at', async () => {
      await forge.remove('forge-test-skill');

      expect(state.db.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE skill_versions SET deleted_at'),
      );
    });

    it('uninstalls from plugin registry', async () => {
      await forge.remove('forge-test-skill');

      expect(pluginRegistry.uninstall).toHaveBeenCalledWith('forge-test-skill');
    });

    it('removes via OpenClaw adapter', async () => {
      await forge.remove('forge-test-skill');

      expect(openClaw.removeImport).toHaveBeenCalledWith('forge-test-skill');
    });

    it('emits skillforge.skill.removed event', async () => {
      const events: any[] = [];
      bus.on('skillforge.skill.removed', (d: any) => events.push(d));

      await forge.remove('forge-test-skill');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ skillId: 'forge-test-skill' }));
    });

    it('returns true even if pluginRegistry.uninstall throws', async () => {
      pluginRegistry.uninstall.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await forge.remove('forge-test-skill');

      expect(result).toBe(true);
    });

    it('returns true even if openClaw.removeImport throws', async () => {
      openClaw.removeImport.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = await forge.remove('forge-test-skill');

      expect(result).toBe(true);
    });

    it('removes skill from in-memory version cache', async () => {
      // Create a skill first to populate the cache
      const created = await forge.create(
        {
          name: 'to-remove',
          description: 'desc',
          instructions: 'instr',
        },
        'agent-1',
      );

      // Verify it has versions
      let versions = await forge.listVersions(created.skillId!);
      expect(versions).toHaveLength(1);

      await forge.remove(created.skillId!);

      // Versions should now be empty
      versions = await forge.listVersions(created.skillId!);
      expect(versions).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // listVersions()
  // -----------------------------------------------------------------------

  describe('listVersions()', () => {
    it('returns empty array for unknown skill', async () => {
      const versions = await forge.listVersions('nonexistent');

      expect(versions).toEqual([]);
    });

    it('returns versions after a skill is created', async () => {
      const created = await forge.create(
        {
          name: 'versioned-skill',
          description: 'test versioning',
          instructions: 'do stuff',
        },
        'agent-1',
      );

      const versions = await forge.listVersions(created.skillId!);

      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(1);
      expect(versions[0].created_by).toBe('agent-1');
    });
  });

  // -----------------------------------------------------------------------
  // rollback()
  // -----------------------------------------------------------------------

  describe('rollback()', () => {
    it('returns false for nonexistent skill', async () => {
      const result = await forge.rollback('nonexistent', 1);

      expect(result).toBe(false);
    });

    it('returns false for nonexistent version number', async () => {
      const created = await forge.create(
        {
          name: 'rb-test',
          description: 'desc',
          instructions: 'instr',
        },
        'agent-1',
      );

      const result = await forge.rollback(created.skillId!, 999);

      expect(result).toBe(false);
    });

    it('rolls back to a previous version and emits event', async () => {
      const createResult = await forge.create(
        {
          name: 'rb-skill',
          description: 'rollback test',
          instructions: 'original instructions',
        },
        'agent-1',
      );

      const events: any[] = [];
      bus.on('skillforge.skill.rollback', (d: any) => events.push(d));

      const result = await forge.rollback(createResult.skillId!, 1);

      expect(result).toBe(true);
      // importSkill is called once during create, then once during rollback
      expect(openClaw.importSkill).toHaveBeenCalledTimes(2);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          skillId: createResult.skillId,
          rolledBackTo: 1,
          newVersion: 2,
        }),
      );
    });

    it('creates a new version entry marked as rollback', async () => {
      const createResult = await forge.create(
        {
          name: 'rb-version-test',
          description: 'desc',
          instructions: 'instr',
        },
        'agent-1',
      );

      await forge.rollback(createResult.skillId!, 1);

      const versions = await forge.listVersions(createResult.skillId!);
      expect(versions).toHaveLength(2);
      expect(versions[1].version).toBe(2);
      expect(versions[1].created_by).toBe('rollback');
    });

    it('returns false if importSkill fails during rollback', async () => {
      const createResult = await forge.create(
        {
          name: 'rb-fail',
          description: 'desc',
          instructions: 'instr',
        },
        'agent-1',
      );

      // Make the next importSkill call fail
      openClaw.importSkill.mockRejectedValueOnce(new Error('import error'));

      const result = await forge.rollback(createResult.skillId!, 1);

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // propose()
  // -----------------------------------------------------------------------

  describe('propose()', () => {
    const suggestion = {
      name: 'auto-formatter',
      description: 'Formats code',
      instructions: 'Run prettier on the file',
      tools_used: ['shell.exec'],
    };

    it('returns a proposalId with pending status', () => {
      const result = forge.propose(suggestion, 'agent-1');

      expect(result.proposalId).toBeDefined();
      expect(typeof result.proposalId).toBe('string');
      expect(result.status).toBe('pending');
    });

    it('persists the proposal via state.insertProposal', () => {
      forge.propose(suggestion, 'agent-1');

      expect(state.insertProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          skill_name: 'auto-formatter',
          skill_description: 'Formats code',
          skill_instructions: 'Run prettier on the file',
          tools_used: JSON.stringify(['shell.exec']),
          proposing_agent: 'agent-1',
          status: 'pending',
          risk_score: 'minimal',
        }),
      );
    });

    it('emits skillforge.skill.proposed event', () => {
      const events: any[] = [];
      bus.on('skillforge.skill.proposed', (d: any) => events.push(d));

      forge.propose(suggestion, 'agent-1');

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          name: 'auto-formatter',
          agentUid: 'agent-1',
          riskLevel: 'minimal',
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // approve()
  // -----------------------------------------------------------------------

  describe('approve()', () => {
    it('returns failure when proposal is not found', async () => {
      state.getProposal.mockReturnValue(undefined);

      const result = await forge.approve('missing-id');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Proposal not found');
    });

    it('returns failure when proposal is already approved', async () => {
      state.getProposal.mockReturnValue({
        id: 'p1',
        status: 'approved',
      });

      const result = await forge.approve('p1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('already approved');
    });

    it('creates the skill from a pending proposal', async () => {
      state.getProposal.mockReturnValue({
        id: 'p1',
        status: 'pending',
        skill_name: 'approved-skill',
        skill_description: 'desc',
        skill_instructions: 'do things',
        tools_used: '["tool-a"]',
        proposing_agent: 'agent-1',
      });

      const events: any[] = [];
      bus.on('skillforge.proposal.approved', (d: any) => events.push(d));

      const result = await forge.approve('p1', 'reviewer-1');

      expect(result.success).toBe(true);
      expect(result.skillId).toBeDefined();
      expect(state.updateProposalStatus).toHaveBeenCalledWith('p1', 'approved', 'reviewer-1');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(expect.objectContaining({ proposalId: 'p1' }));
    });
  });

  // -----------------------------------------------------------------------
  // reject()
  // -----------------------------------------------------------------------

  describe('reject()', () => {
    it('returns failure when proposal is not found', () => {
      state.getProposal.mockReturnValue(undefined);

      const result = forge.reject('missing-id');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Proposal not found');
    });

    it('returns failure when proposal is already rejected', () => {
      state.getProposal.mockReturnValue({ id: 'p1', status: 'rejected' });

      const result = forge.reject('p1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('already rejected');
    });

    it('rejects a pending proposal with reason', () => {
      state.getProposal.mockReturnValue({ id: 'p1', status: 'pending' });
      const events: any[] = [];
      bus.on('skillforge.proposal.rejected', (d: any) => events.push(d));

      const result = forge.reject('p1', 'not good enough', 'reviewer-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('rejected');
      expect(result.message).toContain('not good enough');
      expect(state.updateProposalStatus).toHaveBeenCalledWith('p1', 'rejected', 'reviewer-1');
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          proposalId: 'p1',
          reason: 'not good enough',
        }),
      );
    });

    it('rejects without a reason', () => {
      state.getProposal.mockReturnValue({ id: 'p2', status: 'pending' });

      const result = forge.reject('p2');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Proposal rejected');
    });
  });

  // -----------------------------------------------------------------------
  // listProposals()
  // -----------------------------------------------------------------------

  describe('listProposals()', () => {
    it('returns all proposals when no status filter is given', () => {
      state.getAllProposals.mockReturnValue([
        { id: 'p1', status: 'pending' },
        { id: 'p2', status: 'approved' },
      ]);

      const proposals = forge.listProposals();

      expect(proposals).toHaveLength(2);
      expect(state.getAllProposals).toHaveBeenCalledOnce();
    });

    it('filters proposals by status when provided', () => {
      state.getProposalsByStatus.mockReturnValue([{ id: 'p1', status: 'pending' }]);

      const proposals = forge.listProposals('pending');

      expect(proposals).toHaveLength(1);
      expect(state.getProposalsByStatus).toHaveBeenCalledWith('pending');
    });
  });

  // -----------------------------------------------------------------------
  // recordSkillUsage()
  // -----------------------------------------------------------------------

  describe('recordSkillUsage()', () => {
    it('increments usage count via plugin registry', () => {
      forge.recordSkillUsage('skill-1');

      expect(pluginRegistry.incrementUsage).toHaveBeenCalledWith('skill-1');
    });

    it('records quality rating when provided', () => {
      forge.recordSkillUsage('skill-1', 4.5);

      expect(pluginRegistry.addQualityRating).toHaveBeenCalledWith('skill-1', 4.5);
    });

    it('does not record quality rating when omitted', () => {
      forge.recordSkillUsage('skill-1');

      expect(pluginRegistry.addQualityRating).not.toHaveBeenCalled();
    });

    it('emits skillforge.skill.usage event', () => {
      const events: any[] = [];
      bus.on('skillforge.skill.usage', (d: any) => events.push(d));

      forge.recordSkillUsage('skill-1', 3);

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          skillId: 'skill-1',
          qualityRating: 3,
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // share()
  // -----------------------------------------------------------------------

  describe('share()', () => {
    it('returns failure when skill has no versions', async () => {
      const result = await forge.share('nonexistent', 'all', 'agent-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('shares with all agents via plugin registry (target=all)', async () => {
      const created = await forge.create(
        {
          name: 'shared-skill',
          description: 'to share',
          instructions: 'share instructions',
        },
        'agent-1',
      );

      const events: any[] = [];
      bus.on('skillforge.skill.shared', (d: any) => events.push(d));

      const result = await forge.share(created.skillId!, 'all', 'agent-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('shared with all agents');
      expect(pluginRegistry.install).toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(
        expect.objectContaining({
          skillId: created.skillId,
          target: 'all',
          sharedBy: 'agent-1',
        }),
      );
    });

    it('returns skill content for IPC delivery (target=agent)', async () => {
      const created = await forge.create(
        {
          name: 'ipc-skill',
          description: 'for ipc',
          instructions: 'ipc instructions',
        },
        'agent-1',
      );

      const result = await forge.share(created.skillId!, 'agent', 'agent-1');

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content!.length).toBeGreaterThan(0);
      expect(result.message).toContain('IPC delivery');
    });

    it('returns failure if pluginRegistry.install throws (target=all)', async () => {
      const created = await forge.create(
        {
          name: 'fail-share',
          description: 'fail',
          instructions: 'fail',
        },
        'agent-1',
      );

      pluginRegistry.install.mockImplementation(() => {
        throw new Error('already exists');
      });

      const result = await forge.share(created.skillId!, 'all', 'agent-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to register');
    });
  });
});
