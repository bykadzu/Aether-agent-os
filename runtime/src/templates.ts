/**
 * Aether Runtime - Agent Templates
 *
 * Pre-built agent configurations that lower the barrier to deploying agents.
 * Instead of configuring role + goal manually, users can select a template
 * with sensible defaults and just customize the goal.
 */

import { AgentConfig } from '@aether/shared';

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;               // Lucide icon name
  category: 'development' | 'research' | 'data' | 'creative' | 'ops';
  config: Partial<AgentConfig>;
  suggestedGoals: string[];   // Example goals to get started
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'web-researcher',
    name: 'Web Researcher',
    description: 'Searches the web, reads pages, and compiles research summaries into documents.',
    icon: 'Globe',
    category: 'research',
    config: {
      role: 'Researcher',
      tools: ['browse_web', 'browse_interactive', 'browser_click', 'browser_type', 'browser_close', 'write_file', 'read_file', 'think'],
      maxSteps: 30,
    },
    suggestedGoals: [
      'Research the latest developments in AI agents and write a summary',
      'Find the top 5 open-source LLM frameworks and compare them',
      'Research best practices for Kubernetes security',
    ],
  },
  {
    id: 'web-navigator',
    name: 'Web Navigator',
    description: 'Browses the web with a full Chromium browser. Can click, type, scroll, and take screenshots of real web pages.',
    icon: 'Navigation',
    category: 'research',
    config: {
      role: 'Navigator',
      tools: [
        'browse_web',
        'browse_interactive',
        'browser_click',
        'browser_type',
        'browser_screenshot',
        'browser_scroll',
        'browser_close',
        'write_file',
        'read_file',
        'think',
      ],
      maxSteps: 40,
    },
    suggestedGoals: [
      'Navigate to a website, fill out a form, and submit it',
      'Take screenshots of competitor landing pages for analysis',
      'Browse documentation sites and extract code examples',
    ],
  },
  {
    id: 'code-developer',
    name: 'Code Developer',
    description: 'Writes, reads, and executes code. Builds features and fixes bugs in your codebase.',
    icon: 'Code',
    category: 'development',
    config: {
      role: 'Coder',
      tools: ['read_file', 'write_file', 'run_command', 'list_files', 'mkdir', 'think'],
      maxSteps: 50,
    },
    suggestedGoals: [
      'Build a REST API for a todo list application',
      'Refactor the authentication module to use JWT tokens',
      'Create a Python script that processes CSV files into charts',
    ],
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    description: 'Reads code files, analyzes patterns, and provides detailed code review feedback.',
    icon: 'FileSearch',
    category: 'development',
    config: {
      role: 'Reviewer',
      tools: ['read_file', 'list_files', 'think'],
      maxSteps: 20,
    },
    suggestedGoals: [
      'Review the codebase for security vulnerabilities',
      'Audit the error handling patterns across all modules',
      'Review the API endpoint implementations for best practices',
    ],
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    description: 'Analyzes datasets, generates reports, and creates visualizations using scripts.',
    icon: 'BarChart3',
    category: 'data',
    config: {
      role: 'Analyst',
      tools: ['read_file', 'write_file', 'run_command', 'list_files', 'think'],
      maxSteps: 40,
    },
    suggestedGoals: [
      'Analyze the dataset at ~/data/sales.csv and generate a summary report',
      'Create a Python script to visualize trends in the log data',
      'Parse the JSON API response files and calculate key metrics',
    ],
  },
  {
    id: 'system-admin',
    name: 'System Admin',
    description: 'Manages system configurations, debugs issues, and automates infrastructure tasks.',
    icon: 'Server',
    category: 'ops',
    config: {
      role: 'SysAdmin',
      tools: ['run_command', 'read_file', 'write_file', 'list_files', 'think'],
      maxSteps: 40,
    },
    suggestedGoals: [
      'Set up a development environment with Node.js and Docker',
      'Debug why the deployment pipeline is failing',
      'Write a shell script to automate database backups',
    ],
  },
  {
    id: 'technical-writer',
    name: 'Technical Writer',
    description: 'Creates documentation, tutorials, and technical content from code or research.',
    icon: 'BookOpen',
    category: 'creative',
    config: {
      role: 'Writer',
      tools: ['read_file', 'write_file', 'browse_web', 'list_files', 'think'],
      maxSteps: 30,
    },
    suggestedGoals: [
      'Write API documentation for the user service endpoints',
      'Create a getting-started tutorial for the project',
      'Document the database schema and migration process',
    ],
  },
  {
    id: 'test-engineer',
    name: 'Test Engineer',
    description: 'Writes test suites, sets up CI pipelines, and validates code quality.',
    icon: 'TestTube',
    category: 'development',
    config: {
      role: 'Tester',
      tools: ['read_file', 'write_file', 'run_command', 'list_files', 'think'],
      maxSteps: 40,
    },
    suggestedGoals: [
      'Write unit tests for the authentication module',
      'Set up a CI pipeline with GitHub Actions',
      'Create integration tests for the REST API endpoints',
    ],
  },
  {
    id: 'project-manager',
    name: 'Project Manager',
    description: 'Coordinates other agents, delegates tasks, and tracks project progress.',
    icon: 'Users',
    category: 'ops',
    config: {
      role: 'PM',
      tools: ['list_agents', 'send_message', 'check_messages', 'think', 'write_file'],
      maxSteps: 30,
    },
    suggestedGoals: [
      'Coordinate the team to ship the v2.0 release',
      'Create a project plan for the new feature rollout',
      'Review status updates from all running agents and compile a summary',
    ],
  },
];

/**
 * Get a template by its ID.
 */
export function getTemplate(id: string): AgentTemplate | undefined {
  return AGENT_TEMPLATES.find(t => t.id === id);
}

/**
 * Get templates filtered by category.
 */
export function getTemplatesByCategory(category: AgentTemplate['category']): AgentTemplate[] {
  return AGENT_TEMPLATES.filter(t => t.category === category);
}
