/**
 * Aether Kernel - Default Template Seeds
 *
 * Seeds 16 agent templates on first run when the marketplace is empty.
 * Each template provides a complete agent configuration with role,
 * tools, suggested goals, and tags.
 */

export interface SeedTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'development' | 'research' | 'data' | 'creative' | 'ops';
  config: { role: string; model: string; tools: string[]; maxSteps: number };
  suggestedGoals: string[];
  author: string;
  tags: string[];
}

export function getDefaultTemplates(): SeedTemplate[] {
  return [
    {
      id: 'full-stack-developer',
      name: 'Full-Stack Developer',
      description: 'Builds end-to-end web applications with modern frameworks and databases.',
      icon: '\u{1F4BB}',
      category: 'development',
      config: {
        role: 'Full-stack developer skilled in React, Node.js, TypeScript, and PostgreSQL',
        model: 'auto',
        tools: [
          'execute_command',
          'read_file',
          'write_file',
          'list_directory',
          'search_files',
          'browse_web',
        ],
        maxSteps: 50,
      },
      suggestedGoals: [
        'Build a REST API with Express and PostgreSQL',
        'Create a React dashboard with charts',
        'Set up a CI/CD pipeline with GitHub Actions',
        'Refactor a monolith into microservices',
      ],
      author: 'Aether OS Team',
      tags: ['react', 'nodejs', 'typescript', 'fullstack', 'web'],
    },
    {
      id: 'python-developer',
      name: 'Python Developer',
      description: 'Develops Python applications, APIs, test suites, and data pipelines.',
      icon: '\u{1F40D}',
      category: 'development',
      config: {
        role: 'Python developer experienced with Flask, Django, testing, and data pipelines',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'write_file', 'list_directory', 'search_files'],
        maxSteps: 40,
      },
      suggestedGoals: [
        'Build a Flask REST API with SQLAlchemy',
        'Create a Django web application',
        'Write comprehensive pytest test suite',
        'Build an ETL data pipeline',
      ],
      author: 'Aether OS Team',
      tags: ['python', 'flask', 'django', 'testing', 'backend'],
    },
    {
      id: 'devops-engineer',
      name: 'DevOps Engineer',
      description: 'Automates infrastructure, containerization, and deployment pipelines.',
      icon: '\u{1F527}',
      category: 'ops',
      config: {
        role: 'DevOps engineer specializing in Docker, Kubernetes, Terraform, and CI/CD',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'write_file', 'list_directory', 'browse_web'],
        maxSteps: 40,
      },
      suggestedGoals: [
        'Containerize an application with Docker and docker-compose',
        'Set up Kubernetes deployment with Helm charts',
        'Write Terraform infrastructure as code',
        'Configure monitoring with Prometheus and Grafana',
      ],
      author: 'Aether OS Team',
      tags: ['docker', 'kubernetes', 'terraform', 'cicd', 'infrastructure'],
    },
    {
      id: 'security-auditor',
      name: 'Security Auditor',
      description: 'Audits codebases for vulnerabilities, dependency risks, and compliance gaps.',
      icon: '\u{1F512}',
      category: 'ops',
      config: {
        role: 'Security auditor focused on OWASP Top 10, dependency scanning, and code review',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'search_files', 'list_directory', 'browse_web'],
        maxSteps: 30,
      },
      suggestedGoals: [
        'Audit codebase for OWASP Top 10 vulnerabilities',
        'Scan dependencies for known CVEs',
        'Review authentication and authorization implementation',
        'Generate a security assessment report',
      ],
      author: 'Aether OS Team',
      tags: ['security', 'owasp', 'audit', 'vulnerabilities', 'compliance'],
    },
    {
      id: 'data-scientist',
      name: 'Data Scientist',
      description: 'Performs exploratory analysis, builds ML models, and creates visualizations.',
      icon: '\u{1F4CA}',
      category: 'data',
      config: {
        role: 'Data scientist proficient in Python, pandas, matplotlib, scikit-learn, and statistical analysis',
        model: 'auto',
        tools: [
          'execute_command',
          'read_file',
          'write_file',
          'list_directory',
          'browse_web',
          'analyze_image',
        ],
        maxSteps: 40,
      },
      suggestedGoals: [
        'Perform exploratory data analysis on a CSV dataset',
        'Build a classification model with scikit-learn',
        'Create data visualizations with matplotlib',
        'Write a statistical analysis report',
      ],
      author: 'Aether OS Team',
      tags: ['python', 'pandas', 'ml', 'statistics', 'visualization'],
    },
    {
      id: 'technical-writer',
      name: 'Technical Writer',
      description: 'Creates clear API docs, READMEs, architecture guides, and migration plans.',
      icon: '\u{1F4DD}',
      category: 'creative',
      config: {
        role: 'Technical writer creating clear API documentation, README files, and architecture guides',
        model: 'auto',
        tools: ['read_file', 'write_file', 'list_directory', 'search_files', 'browse_web'],
        maxSteps: 30,
      },
      suggestedGoals: [
        'Write comprehensive API documentation with examples',
        'Create a project README with setup instructions',
        'Document system architecture with diagrams',
        'Write a migration guide for a major version upgrade',
      ],
      author: 'Aether OS Team',
      tags: ['documentation', 'api-docs', 'readme', 'technical-writing', 'markdown'],
    },
    {
      id: 'ui-ux-designer',
      name: 'UI/UX Designer',
      description:
        'Converts designs to code, performs accessibility audits, and builds component libraries.',
      icon: '\u{1F3A8}',
      category: 'creative',
      config: {
        role: 'UI/UX designer converting designs to code, performing accessibility audits, and prototyping',
        model: 'auto',
        tools: ['read_file', 'write_file', 'browse_web', 'analyze_image', 'search_files'],
        maxSteps: 35,
      },
      suggestedGoals: [
        'Convert a Figma design into responsive HTML/CSS',
        'Perform an accessibility audit (WCAG 2.1 AA)',
        'Create a component library with design tokens',
        'Prototype a mobile-first responsive layout',
      ],
      author: 'Aether OS Team',
      tags: ['design', 'css', 'accessibility', 'responsive', 'ui'],
    },
    {
      id: 'database-admin',
      name: 'Database Admin',
      description: 'Designs schemas, optimizes queries, writes migrations, and manages backups.',
      icon: '\u{1F5C4}\uFE0F',
      category: 'ops',
      config: {
        role: 'Database administrator specializing in schema design, query optimization, and migrations',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'write_file', 'search_files'],
        maxSteps: 30,
      },
      suggestedGoals: [
        'Design a normalized database schema',
        'Optimize slow SQL queries with EXPLAIN ANALYZE',
        'Write database migration scripts',
        'Set up database backup and recovery procedures',
      ],
      author: 'Aether OS Team',
      tags: ['sql', 'postgresql', 'mysql', 'schema', 'optimization'],
    },
    {
      id: 'ml-engineer',
      name: 'ML Engineer',
      description:
        'Trains and deploys machine learning models with experiment tracking and monitoring.',
      icon: '\u{1F916}',
      category: 'data',
      config: {
        role: 'ML engineer focused on model training, evaluation, deployment, and MLOps',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'write_file', 'list_directory', 'browse_web'],
        maxSteps: 50,
      },
      suggestedGoals: [
        'Train and evaluate a neural network model',
        'Set up an ML training pipeline with experiment tracking',
        'Deploy a model as a REST API endpoint',
        'Implement model monitoring and drift detection',
      ],
      author: 'Aether OS Team',
      tags: ['ml', 'pytorch', 'tensorflow', 'mlops', 'models'],
    },
    {
      id: 'incident-responder',
      name: 'Incident Responder',
      description: 'Analyzes logs, identifies root causes, and coordinates incident remediation.',
      icon: '\u{1F6A8}',
      category: 'ops',
      config: {
        role: 'Incident responder analyzing logs, identifying root causes, and coordinating remediation',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'search_files', 'list_directory', 'browse_web'],
        maxSteps: 40,
      },
      suggestedGoals: [
        'Analyze application logs to identify error patterns',
        'Investigate and document a production incident root cause',
        'Create a post-mortem report with action items',
        'Set up alerting rules for critical metrics',
      ],
      author: 'Aether OS Team',
      tags: ['incident', 'debugging', 'logs', 'monitoring', 'oncall'],
    },
    {
      id: 'code-reviewer',
      name: 'Code Reviewer',
      description: 'Reviews pull requests for bugs, best practices, and refactoring opportunities.',
      icon: '\u{1F440}',
      category: 'development',
      config: {
        role: 'Code reviewer enforcing best practices, identifying bugs, and suggesting refactoring improvements',
        model: 'auto',
        tools: ['read_file', 'search_files', 'list_directory'],
        maxSteps: 25,
      },
      suggestedGoals: [
        'Review a pull request for bugs and best practices',
        'Identify code smells and suggest refactoring',
        'Check test coverage and suggest missing tests',
        'Review API design for consistency',
      ],
      author: 'Aether OS Team',
      tags: ['review', 'quality', 'refactoring', 'bestpractices', 'clean-code'],
    },
    {
      id: 'api-developer',
      name: 'API Developer',
      description: 'Designs and implements REST and GraphQL APIs with specs and testing.',
      icon: '\u{1F50C}',
      category: 'development',
      config: {
        role: 'API developer designing and implementing REST and GraphQL APIs with OpenAPI specs',
        model: 'auto',
        tools: [
          'execute_command',
          'read_file',
          'write_file',
          'list_directory',
          'search_files',
          'browse_web',
        ],
        maxSteps: 40,
      },
      suggestedGoals: [
        'Design a RESTful API with OpenAPI specification',
        'Implement a GraphQL server with resolvers',
        'Add rate limiting and authentication to an API',
        'Write API integration tests',
      ],
      author: 'Aether OS Team',
      tags: ['api', 'rest', 'graphql', 'openapi', 'backend'],
    },
    {
      id: 'research-analyst',
      name: 'Research Analyst',
      description: 'Gathers information, synthesizes findings, and produces structured reports.',
      icon: '\u{1F50D}',
      category: 'research',
      config: {
        role: 'Research analyst gathering information, synthesizing findings, and producing structured reports',
        model: 'auto',
        tools: ['browse_web', 'read_file', 'write_file', 'remember', 'recall'],
        maxSteps: 35,
      },
      suggestedGoals: [
        'Research and compare cloud hosting providers',
        'Analyze competitor products and create a comparison matrix',
        'Summarize recent developments in AI/ML',
        'Compile a technology trend report',
      ],
      author: 'Aether OS Team',
      tags: ['research', 'analysis', 'reports', 'comparison', 'trends'],
    },
    {
      id: 'content-creator',
      name: 'Content Creator',
      description: 'Writes blog posts, social media content, newsletters, and marketing copy.',
      icon: '\u{270D}\uFE0F',
      category: 'creative',
      config: {
        role: 'Content creator writing blog posts, social media content, newsletters, and marketing copy',
        model: 'auto',
        tools: ['browse_web', 'read_file', 'write_file', 'remember', 'recall'],
        maxSteps: 30,
      },
      suggestedGoals: [
        'Write a technical blog post about a new feature',
        'Create social media content calendar for a month',
        'Draft a product launch announcement',
        'Write a developer newsletter issue',
      ],
      author: 'Aether OS Team',
      tags: ['writing', 'blog', 'social-media', 'marketing', 'content'],
    },
    {
      id: 'test-engineer',
      name: 'Test Engineer',
      description: 'Writes unit, integration, and E2E tests with high coverage targets.',
      icon: '\u{1F9EA}',
      category: 'development',
      config: {
        role: 'Test engineer writing unit, integration, and E2E tests with high coverage',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'write_file', 'list_directory', 'search_files'],
        maxSteps: 40,
      },
      suggestedGoals: [
        'Write unit tests for a module with 90%+ coverage',
        'Create integration tests for API endpoints',
        'Set up E2E testing with Playwright or Cypress',
        'Implement property-based testing',
      ],
      author: 'Aether OS Team',
      tags: ['testing', 'jest', 'vitest', 'playwright', 'coverage'],
    },
    {
      id: 'system-administrator',
      name: 'System Administrator',
      description: 'Manages servers, monitoring, backups, and infrastructure operations.',
      icon: '\u{1F5A5}\uFE0F',
      category: 'ops',
      config: {
        role: 'System administrator managing servers, monitoring, backups, and infrastructure',
        model: 'auto',
        tools: ['execute_command', 'read_file', 'write_file', 'list_directory', 'browse_web'],
        maxSteps: 35,
      },
      suggestedGoals: [
        'Set up server monitoring with health checks',
        'Configure automated backup procedures',
        'Harden server security and firewall rules',
        'Create runbooks for common operational tasks',
      ],
      author: 'Aether OS Team',
      tags: ['sysadmin', 'linux', 'monitoring', 'backups', 'infrastructure'],
    },
  ];
}
