import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus, StateStore } from '@aether/kernel';
import {
  createPlan,
  getActivePlan,
  updatePlan,
  updateNodeStatus,
  renderPlanAsMarkdown,
  getPlanProgress,
} from '../planner.js';
import type { PlanNode } from '@aether/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('Goal Decomposition & Planning', () => {
  let bus: EventBus;
  let store: StateStore;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join(
      '/tmp',
      `aether-planner-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // Mock kernel with real StateStore
  function createMockKernel() {
    return {
      state: store,
      bus: bus,
    } as any;
  }

  const sampleNodes: PlanNode[] = [
    {
      id: '',
      title: 'Research requirements',
      description: 'Gather all project requirements',
      status: 'pending',
      estimated_steps: 3,
      actual_steps: 0,
      children: [],
    },
    {
      id: '',
      title: 'Implement features',
      status: 'pending',
      estimated_steps: 10,
      actual_steps: 0,
      children: [
        {
          id: '',
          title: 'Set up database schema',
          status: 'pending',
          estimated_steps: 2,
          actual_steps: 0,
          children: [],
        },
        {
          id: '',
          title: 'Build API endpoints',
          status: 'pending',
          estimated_steps: 5,
          actual_steps: 0,
          children: [],
        },
      ],
    },
    {
      id: '',
      title: 'Write tests',
      status: 'pending',
      estimated_steps: 4,
      actual_steps: 0,
      children: [],
    },
  ];

  // ---------------------------------------------------------------------------
  // createPlan
  // ---------------------------------------------------------------------------

  describe('createPlan', () => {
    it('creates a plan with hierarchical nodes', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Build a web app', sampleNodes);

      expect(plan.id).toBeDefined();
      expect(plan.agent_uid).toBe('agent_1');
      expect(plan.pid).toBe(1);
      expect(plan.goal).toBe('Build a web app');
      expect(plan.status).toBe('active');
      expect(plan.root_nodes).toHaveLength(3);
    });

    it('assigns UUIDs to nodes without IDs', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      // All nodes should have IDs
      for (const node of plan.root_nodes) {
        expect(node.id).toBeDefined();
        expect(node.id.length).toBeGreaterThan(0);
        for (const child of node.children) {
          expect(child.id).toBeDefined();
          expect(child.id.length).toBeGreaterThan(0);
        }
      }
    });

    it('preserves hierarchical structure', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      expect(plan.root_nodes[1].children).toHaveLength(2);
      expect(plan.root_nodes[1].children[0].title).toBe('Set up database schema');
      expect(plan.root_nodes[1].children[1].title).toBe('Build API endpoints');
    });

    it('emits plan.created event', () => {
      const events: any[] = [];
      bus.on('plan.created', (data: any) => events.push(data));

      const kernel = createMockKernel();
      createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      expect(events).toHaveLength(1);
      expect(events[0].plan.goal).toBe('Test plan');
    });

    it('persists plan to database', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const stored = store.getPlan(plan.id);
      expect(stored).toBeDefined();
      expect(stored.goal).toBe('Test plan');
      expect(stored.status).toBe('active');
    });

    it('abandons previous active plan when creating new one', () => {
      const kernel = createMockKernel();
      const plan1 = createPlan(kernel, 1, 'agent_1', 'First plan', sampleNodes);
      const plan2 = createPlan(kernel, 1, 'agent_1', 'Second plan', sampleNodes);

      // First plan should be abandoned
      const stored1 = store.getPlan(plan1.id);
      expect(stored1.status).toBe('abandoned');

      // Second plan should be active
      const stored2 = store.getPlan(plan2.id);
      expect(stored2.status).toBe('active');
    });
  });

  // ---------------------------------------------------------------------------
  // getActivePlan
  // ---------------------------------------------------------------------------

  describe('getActivePlan', () => {
    it('returns active plan for a PID', () => {
      const kernel = createMockKernel();
      const created = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const retrieved = getActivePlan(kernel, 1);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.root_nodes).toHaveLength(3);
    });

    it('returns null when no active plan exists', () => {
      const kernel = createMockKernel();
      const result = getActivePlan(kernel, 999);
      expect(result).toBeNull();
    });

    it('correctly hydrates plan_tree JSON', () => {
      const kernel = createMockKernel();
      createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const plan = getActivePlan(kernel, 1);
      expect(plan!.root_nodes[1].children).toHaveLength(2);
      expect(plan!.root_nodes[1].children[0].title).toBe('Set up database schema');
    });
  });

  // ---------------------------------------------------------------------------
  // updateNodeStatus
  // ---------------------------------------------------------------------------

  describe('updateNodeStatus', () => {
    it('updates a root node status', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const nodeId = plan.root_nodes[0].id;
      const updated = updateNodeStatus(kernel, plan.id, nodeId, 'active');

      expect(updated).not.toBeNull();
      expect(updated!.root_nodes[0].status).toBe('active');
    });

    it('updates a child node status', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const childId = plan.root_nodes[1].children[0].id;
      const updated = updateNodeStatus(kernel, plan.id, childId, 'completed', 3);

      expect(updated).not.toBeNull();
      expect(updated!.root_nodes[1].children[0].status).toBe('completed');
      expect(updated!.root_nodes[1].children[0].actual_steps).toBe(3);
    });

    it('updates actual_steps when provided', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const nodeId = plan.root_nodes[0].id;
      const updated = updateNodeStatus(kernel, plan.id, nodeId, 'completed', 5);

      expect(updated!.root_nodes[0].actual_steps).toBe(5);
    });

    it('returns null for non-existent node', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const result = updateNodeStatus(kernel, plan.id, 'non-existent-id', 'completed');
      expect(result).toBeNull();
    });

    it('returns null for non-existent plan', () => {
      const kernel = createMockKernel();
      const result = updateNodeStatus(kernel, 'non-existent-plan', 'some-id', 'completed');
      expect(result).toBeNull();
    });

    it('emits plan.updated event', () => {
      const events: any[] = [];
      bus.on('plan.updated', (data: any) => events.push(data));

      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);
      const nodeId = plan.root_nodes[0].id;
      updateNodeStatus(kernel, plan.id, nodeId, 'completed');

      expect(events).toHaveLength(1);
    });

    it('auto-completes plan when all nodes are terminal', () => {
      const kernel = createMockKernel();
      const simpleNodes: PlanNode[] = [
        {
          id: '',
          title: 'Step 1',
          status: 'pending',
          estimated_steps: 1,
          actual_steps: 0,
          children: [],
        },
        {
          id: '',
          title: 'Step 2',
          status: 'pending',
          estimated_steps: 1,
          actual_steps: 0,
          children: [],
        },
      ];

      const plan = createPlan(kernel, 1, 'agent_1', 'Simple plan', simpleNodes);

      // Complete first node
      updateNodeStatus(kernel, plan.id, plan.root_nodes[0].id, 'completed');

      // Plan should still be active
      let current = getActivePlan(kernel, 1);
      expect(current!.status).toBe('active');

      // Complete second node
      updateNodeStatus(kernel, plan.id, plan.root_nodes[1].id, 'completed');

      // Plan should now be auto-completed
      const finalPlan = store.getPlan(plan.id);
      expect(finalPlan.status).toBe('completed');
    });
  });

  // ---------------------------------------------------------------------------
  // updatePlan
  // ---------------------------------------------------------------------------

  describe('updatePlan', () => {
    it('updates plan status', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const updated = updatePlan(kernel, plan.id, { status: 'completed' });
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('completed');
    });

    it('replaces plan nodes (re-planning)', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test plan', sampleNodes);

      const newNodes: PlanNode[] = [
        {
          id: 'new-1',
          title: 'Revised step 1',
          status: 'pending',
          estimated_steps: 2,
          actual_steps: 0,
          children: [],
        },
      ];

      const updated = updatePlan(kernel, plan.id, { root_nodes: newNodes });
      expect(updated).not.toBeNull();
      expect(updated!.root_nodes).toHaveLength(1);
      expect(updated!.root_nodes[0].title).toBe('Revised step 1');
    });

    it('returns null for non-existent plan', () => {
      const kernel = createMockKernel();
      const result = updatePlan(kernel, 'non-existent', { status: 'completed' });
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // renderPlanAsMarkdown
  // ---------------------------------------------------------------------------

  describe('renderPlanAsMarkdown', () => {
    it('renders plan as markdown checklist', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Build web app', sampleNodes);

      const md = renderPlanAsMarkdown(plan);
      expect(md).toContain('## Current Plan: Build web app');
      expect(md).toContain('Status: active');
      expect(md).toContain('- [ ] Research requirements');
      expect(md).toContain('- [ ] Implement features');
      expect(md).toContain('  - [ ] Set up database schema');
      expect(md).toContain('- [ ] Write tests');
    });

    it('renders different status icons', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test', sampleNodes);

      // Update various statuses
      updateNodeStatus(kernel, plan.id, plan.root_nodes[0].id, 'completed');
      updateNodeStatus(kernel, plan.id, plan.root_nodes[1].id, 'active');
      updateNodeStatus(kernel, plan.id, plan.root_nodes[2].id, 'failed');

      const updated = getActivePlan(kernel, 1)!;
      const md = renderPlanAsMarkdown(updated);

      expect(md).toContain('- [x] Research requirements');
      expect(md).toContain('- [~] Implement features');
      expect(md).toContain('- [!] Write tests');
    });

    it('shows step counts', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test', sampleNodes);

      // Update actual steps
      updateNodeStatus(kernel, plan.id, plan.root_nodes[0].id, 'completed', 2);

      const updated = getActivePlan(kernel, 1)!;
      const md = renderPlanAsMarkdown(updated);

      expect(md).toContain('(2/3 steps)');
    });
  });

  // ---------------------------------------------------------------------------
  // getPlanProgress
  // ---------------------------------------------------------------------------

  describe('getPlanProgress', () => {
    it('returns correct initial counts', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test', sampleNodes);

      const progress = getPlanProgress(plan);
      // 3 root + 2 children = 5 total
      expect(progress.total).toBe(5);
      expect(progress.pending).toBe(5);
      expect(progress.completed).toBe(0);
      expect(progress.active).toBe(0);
      expect(progress.failed).toBe(0);
      expect(progress.skipped).toBe(0);
    });

    it('tracks progress as nodes are updated', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test', sampleNodes);

      updateNodeStatus(kernel, plan.id, plan.root_nodes[0].id, 'completed');
      updateNodeStatus(kernel, plan.id, plan.root_nodes[1].id, 'active');

      const updated = getActivePlan(kernel, 1)!;
      const progress = getPlanProgress(updated);

      expect(progress.completed).toBe(1);
      expect(progress.active).toBe(1);
      expect(progress.pending).toBe(3); // remaining nodes
    });

    it('counts child nodes correctly', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test', sampleNodes);

      // Complete a child node
      updateNodeStatus(kernel, plan.id, plan.root_nodes[1].children[0].id, 'completed');
      updateNodeStatus(kernel, plan.id, plan.root_nodes[1].children[1].id, 'failed');

      const updated = getActivePlan(kernel, 1)!;
      const progress = getPlanProgress(updated);

      expect(progress.completed).toBe(1);
      expect(progress.failed).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-session persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('plan survives store close and reopen', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Persistent plan', sampleNodes);

      // Close and reopen
      store.close();
      const store2 = new StateStore(bus, dbPath);

      try {
        const kernel2 = { state: store2, bus } as any;
        const retrieved = getActivePlan(kernel2, 1);
        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe(plan.id);
        expect(retrieved!.goal).toBe('Persistent plan');
        expect(retrieved!.root_nodes).toHaveLength(3);
      } finally {
        store2.close();
      }
    });

    it('node updates persist across reopens', () => {
      const kernel = createMockKernel();
      const plan = createPlan(kernel, 1, 'agent_1', 'Test', sampleNodes);
      updateNodeStatus(kernel, plan.id, plan.root_nodes[0].id, 'completed', 2);

      store.close();
      const store2 = new StateStore(bus, dbPath);

      try {
        const kernel2 = { state: store2, bus } as any;
        const retrieved = getActivePlan(kernel2, 1);
        expect(retrieved!.root_nodes[0].status).toBe('completed');
        expect(retrieved!.root_nodes[0].actual_steps).toBe(2);
      } finally {
        store2.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Plans by agent
  // ---------------------------------------------------------------------------

  describe('getPlansByAgent', () => {
    it('returns all plans for an agent', () => {
      const kernel = createMockKernel();
      createPlan(kernel, 1, 'agent_1', 'Plan 1', sampleNodes);
      createPlan(kernel, 2, 'agent_1', 'Plan 2', sampleNodes);

      const plans = store.getPlansByAgent('agent_1');
      expect(plans).toHaveLength(2);
    });

    it('does not return plans from other agents', () => {
      const kernel = createMockKernel();
      createPlan(kernel, 1, 'agent_1', 'Agent 1 plan', sampleNodes);
      createPlan(kernel, 2, 'agent_2', 'Agent 2 plan', sampleNodes);

      const plans = store.getPlansByAgent('agent_1');
      expect(plans).toHaveLength(1);
      expect(plans[0].agent_uid).toBe('agent_1');
    });
  });
});
