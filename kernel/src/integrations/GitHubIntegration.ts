/**
 * Aether Kernel - GitHub Integration (v0.4 Wave 2)
 *
 * Implements the IIntegration interface for GitHub REST API v3.
 * Uses native fetch() — no external dependencies.
 */

import type { IIntegration, IntegrationActionDef } from './IIntegration.js';

const GITHUB_API = 'https://api.github.com';

const ACTIONS: IntegrationActionDef[] = [
  {
    name: 'github.list_repos',
    description: 'List repositories for the authenticated user',
  },
  {
    name: 'github.get_repo',
    description: 'Get details of a specific repository',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
    },
  },
  {
    name: 'github.list_prs',
    description: 'List pull requests for a repository',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      state: { type: 'string', description: 'Filter by state (open, closed, all)' },
    },
  },
  {
    name: 'github.create_pr',
    description: 'Create a pull request',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      title: { type: 'string', description: 'PR title', required: true },
      body: { type: 'string', description: 'PR body', required: true },
      head: { type: 'string', description: 'Head branch', required: true },
      base: { type: 'string', description: 'Base branch', required: true },
    },
  },
  {
    name: 'github.get_pr',
    description: 'Get details of a specific pull request',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      pull_number: { type: 'number', description: 'Pull request number', required: true },
    },
  },
  {
    name: 'github.merge_pr',
    description: 'Merge a pull request',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      pull_number: { type: 'number', description: 'Pull request number', required: true },
    },
  },
  {
    name: 'github.list_issues',
    description: 'List issues for a repository',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      state: { type: 'string', description: 'Filter by state (open, closed, all)' },
    },
  },
  {
    name: 'github.create_issue',
    description: 'Create an issue',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      title: { type: 'string', description: 'Issue title', required: true },
      body: { type: 'string', description: 'Issue body', required: true },
    },
  },
  {
    name: 'github.get_issue',
    description: 'Get details of a specific issue',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      issue_number: { type: 'number', description: 'Issue number', required: true },
    },
  },
  {
    name: 'github.comment',
    description: 'Add a comment to an issue or pull request',
    parameters: {
      owner: { type: 'string', description: 'Repository owner', required: true },
      repo: { type: 'string', description: 'Repository name', required: true },
      issue_number: { type: 'number', description: 'Issue/PR number', required: true },
      body: { type: 'string', description: 'Comment body', required: true },
    },
  },
];

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Aether-OS/0.4',
    'Content-Type': 'application/json',
  };
}

export class GitHubIntegration implements IIntegration {
  readonly type = 'github';

  getAvailableActions(): IntegrationActionDef[] {
    return ACTIONS;
  }

  async testConnection(
    credentials: Record<string, string>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${GITHUB_API}/user`, {
        headers: headers(credentials.token),
      });
      if (res.ok) {
        const data = await res.json();
        return { success: true, message: `Connected as ${data.login}` };
      }
      return { success: false, message: `GitHub API returned ${res.status}` };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async executeAction(
    action: string,
    params: Record<string, any>,
    credentials: Record<string, string>,
  ): Promise<any> {
    const h = headers(credentials.token);

    switch (action) {
      case 'github.list_repos': {
        const res = await fetch(`${GITHUB_API}/user/repos`, { headers: h });
        return res.json();
      }

      case 'github.get_repo': {
        const res = await fetch(`${GITHUB_API}/repos/${params.owner}/${params.repo}`, {
          headers: h,
        });
        return res.json();
      }

      case 'github.list_prs': {
        const query = params.state ? `?state=${params.state}` : '';
        const res = await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls${query}`,
          { headers: h },
        );
        return res.json();
      }

      case 'github.create_pr': {
        const res = await fetch(`${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            title: params.title,
            body: params.body,
            head: params.head,
            base: params.base,
          }),
        });
        return res.json();
      }

      case 'github.get_pr': {
        const res = await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`,
          { headers: h },
        );
        return res.json();
      }

      case 'github.merge_pr': {
        const res = await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/merge`,
          {
            method: 'PUT',
            headers: h,
          },
        );
        return res.json();
      }

      case 'github.list_issues': {
        const query = params.state ? `?state=${params.state}` : '';
        const res = await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues${query}`,
          { headers: h },
        );
        return res.json();
      }

      case 'github.create_issue': {
        const res = await fetch(`${GITHUB_API}/repos/${params.owner}/${params.repo}/issues`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            title: params.title,
            body: params.body,
          }),
        });
        return res.json();
      }

      case 'github.get_issue': {
        const res = await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
          { headers: h },
        );
        return res.json();
      }

      case 'github.comment': {
        const res = await fetch(
          `${GITHUB_API}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`,
          {
            method: 'POST',
            headers: h,
            body: JSON.stringify({ body: params.body }),
          },
        );
        return res.json();
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}
