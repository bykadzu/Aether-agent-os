/**
 * Aether Kernel - Default Skill Seeds
 *
 * Seeds 5 reference skill definitions on first run when no skills exist.
 * These demonstrate the lightweight skill format and provide real utility.
 *
 * Skills are declarative YAML-defined tool pipelines that agents can
 * execute without full plugin infrastructure.
 */

import type { SkillDefinition } from './SkillManager.js';

export function getDefaultSkills(): SkillDefinition[] {
  return [
    {
      id: 'summarize-url',
      name: 'summarize-url',
      version: '1.0.0',
      description: 'Fetch a URL and return a concise summary of its content',
      author: 'Aether OS Team',
      category: 'research',
      tags: ['web', 'summarization', 'research'],
      inputs: {
        url: {
          type: 'string',
          description: 'The URL to fetch and summarize',
          required: true,
        },
        max_length: {
          type: 'number',
          description: 'Maximum summary length in words',
          default: 200,
        },
      },
      steps: [
        {
          id: 'fetch',
          action: 'http.get',
          params: { url: '{{inputs.url}}' },
        },
        {
          id: 'summarize',
          action: 'llm.complete',
          params: {
            prompt:
              'Summarize the following web page content in no more than {{inputs.max_length}} words. Be concise and capture the key points:\n\n{{steps.fetch.body}}',
          },
        },
      ],
      output: '{{steps.summarize.text}}',
    },
    {
      id: 'code-review',
      name: 'code-review',
      version: '1.0.0',
      description: 'Read a source file and produce a structured code review with suggestions',
      author: 'Aether OS Team',
      category: 'development',
      tags: ['code-review', 'quality', 'development'],
      inputs: {
        file_path: {
          type: 'string',
          description: 'Path to the source file to review',
          required: true,
        },
        focus: {
          type: 'string',
          description: 'Review focus area (security, performance, readability, all)',
          default: 'all',
        },
      },
      steps: [
        {
          id: 'read_source',
          action: 'fs.read',
          params: { path: '{{inputs.file_path}}' },
        },
        {
          id: 'review',
          action: 'llm.complete',
          params: {
            prompt:
              'You are a senior software engineer. Review the following code with a focus on {{inputs.focus}}. Provide:\n1. A brief summary\n2. Issues found\n3. Suggestions\n4. Quality rating (1-10)\n\nFile: {{inputs.file_path}}\n\n```\n{{steps.read_source.content}}\n```',
          },
        },
        {
          id: 'format',
          action: 'transform.text',
          params: {
            input: '{{steps.review.text}}',
            operation: 'trim',
          },
        },
      ],
      output: '{{steps.format}}',
    },
    {
      id: 'data-transform',
      name: 'data-transform',
      version: '1.0.0',
      description: 'Read a JSON data file, apply a transformation pipeline, and write the result',
      author: 'Aether OS Team',
      category: 'data',
      tags: ['json', 'transform', 'data', 'etl'],
      inputs: {
        input_path: {
          type: 'string',
          description: 'Path to the input JSON file',
          required: true,
        },
        output_path: {
          type: 'string',
          description: 'Path to write the transformed output',
          required: true,
        },
        operation: {
          type: 'string',
          description: 'Transformation operation (pick, pluck, filter, flatten, count)',
          default: 'identity',
        },
        field: {
          type: 'string',
          description: 'Field name for pluck/filter operations',
          default: '',
        },
        value: {
          type: 'string',
          description: 'Value for filter operations',
          default: '',
        },
      },
      steps: [
        {
          id: 'read_input',
          action: 'fs.read',
          params: { path: '{{inputs.input_path}}' },
        },
        {
          id: 'parse',
          action: 'transform.json',
          params: {
            input: '{{steps.read_input.content}}',
            operation: 'parse',
          },
        },
        {
          id: 'transform',
          action: 'transform.json',
          params: {
            input: '{{steps.parse}}',
            operation: '{{inputs.operation}}',
            field: '{{inputs.field}}',
            value: '{{inputs.value}}',
          },
        },
        {
          id: 'stringify',
          action: 'transform.json',
          params: {
            input: '{{steps.transform}}',
            operation: 'stringify',
            indent: 2,
          },
        },
        {
          id: 'write_output',
          action: 'fs.write',
          params: {
            path: '{{inputs.output_path}}',
            content: '{{steps.stringify}}',
          },
        },
      ],
      output: '{{steps.write_output}}',
    },
    {
      id: 'health-check',
      name: 'health-check',
      version: '1.0.0',
      description: 'Check the health of an HTTP endpoint and report its status',
      author: 'Aether OS Team',
      category: 'ops',
      tags: ['monitoring', 'health', 'http', 'ops'],
      inputs: {
        url: {
          type: 'string',
          description: 'The URL of the endpoint to check',
          required: true,
        },
        expected_status: {
          type: 'number',
          description: 'Expected HTTP status code',
          default: 200,
        },
      },
      steps: [
        {
          id: 'check',
          action: 'http.get',
          params: { url: '{{inputs.url}}' },
        },
        {
          id: 'report',
          action: 'transform.json',
          params: {
            input: {
              url: '{{inputs.url}}',
              status: '{{steps.check.status}}',
              expected: '{{inputs.expected_status}}',
              healthy: true,
              timestamp: '{{steps.check.headers.date}}',
            },
            operation: 'stringify',
          },
        },
      ],
      output: '{{steps.report}}',
    },
    {
      id: 'git-changelog',
      name: 'git-changelog',
      version: '1.0.0',
      description: 'Generate a formatted changelog from recent git commits',
      author: 'Aether OS Team',
      category: 'development',
      tags: ['git', 'changelog', 'development', 'release'],
      inputs: {
        repo_path: {
          type: 'string',
          description: 'Path to the git repository',
          required: true,
        },
        count: {
          type: 'number',
          description: 'Number of recent commits to include',
          default: 20,
        },
        format: {
          type: 'string',
          description: 'Output format (text, markdown)',
          default: 'markdown',
        },
      },
      steps: [
        {
          id: 'git_log',
          action: 'shell.exec',
          params: {
            command:
              'cd {{inputs.repo_path}} && git log --oneline --no-decorate -n {{inputs.count}}',
          },
        },
        {
          id: 'git_tags',
          action: 'shell.exec',
          params: {
            command: 'cd {{inputs.repo_path}} && git tag --sort=-creatordate | head -5',
          },
        },
        {
          id: 'format_changelog',
          action: 'llm.complete',
          params: {
            prompt:
              'Generate a {{inputs.format}} changelog from these git commits. Group them by type (Features, Fixes, Refactoring, Docs, Other).\n\nRecent commits:\n{{steps.git_log.stdout}}\n\nLatest tags:\n{{steps.git_tags.stdout}}',
          },
        },
      ],
      output: '{{steps.format_changelog.text}}',
    },
  ];
}
