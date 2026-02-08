/**
 * Aether Kernel - Default Plugin Seeds
 *
 * Seeds 3 reference plugin manifests on first run when no plugins exist.
 * These demonstrate the plugin system and provide real utility.
 */

import type { PluginRegistryManifest } from './PluginRegistryManager.js';

export function getDefaultPlugins(): PluginRegistryManifest[] {
  return [
    {
      id: 'aether-plugin-s3',
      name: 'S3 Storage',
      version: '1.0.0',
      author: 'Aether OS Team',
      description:
        'AWS S3 cloud storage integration for uploading, downloading, and managing files in S3 buckets.',
      category: 'data-sources',
      icon: '\u2601\uFE0F',
      tools: [
        {
          name: 's3_upload',
          description: 'Upload a file to an S3 bucket',
          parameters: {
            bucket: { type: 'string', description: 'S3 bucket name', required: true },
            key: { type: 'string', description: 'Object key (path)', required: true },
            content: { type: 'string', description: 'File content', required: true },
          },
        },
        {
          name: 's3_download',
          description: 'Download a file from an S3 bucket',
          parameters: {
            bucket: { type: 'string', description: 'S3 bucket name', required: true },
            key: { type: 'string', description: 'Object key (path)', required: true },
          },
        },
        {
          name: 's3_list',
          description: 'List objects in an S3 bucket',
          parameters: {
            bucket: { type: 'string', description: 'S3 bucket name', required: true },
            prefix: { type: 'string', description: 'Key prefix filter' },
          },
        },
        {
          name: 's3_delete',
          description: 'Delete an object from an S3 bucket',
          parameters: {
            bucket: { type: 'string', description: 'S3 bucket name', required: true },
            key: { type: 'string', description: 'Object key (path)', required: true },
          },
        },
      ],
      settings: [
        {
          key: 'aws_region',
          label: 'AWS Region',
          type: 'string',
          required: true,
          default: 'us-east-1',
          description: 'AWS region for S3 operations',
        },
        {
          key: 'aws_access_key',
          label: 'Access Key ID',
          type: 'string',
          required: true,
          description: 'AWS access key ID',
        },
        {
          key: 'aws_secret_key',
          label: 'Secret Access Key',
          type: 'string',
          required: true,
          description: 'AWS secret access key',
        },
        {
          key: 'default_bucket',
          label: 'Default Bucket',
          type: 'string',
          description: 'Default S3 bucket name',
        },
      ],
      keywords: ['s3', 'aws', 'storage', 'cloud', 'files'],
    },
    {
      id: 'aether-plugin-slack',
      name: 'Slack Notifications',
      version: '1.0.0',
      author: 'Aether OS Team',
      description: 'Send notifications and files to Slack channels when agent events occur.',
      category: 'notification-channels',
      icon: '\u{1F4AC}',
      tools: [
        {
          name: 'slack_notify',
          description: 'Send a notification message to a Slack channel',
          parameters: {
            channel: { type: 'string', description: 'Slack channel ID or name', required: true },
            message: { type: 'string', description: 'Notification message', required: true },
          },
        },
        {
          name: 'slack_post_file',
          description: 'Post a file to a Slack channel',
          parameters: {
            channel: { type: 'string', description: 'Slack channel ID', required: true },
            content: { type: 'string', description: 'File content', required: true },
            filename: { type: 'string', description: 'Filename', required: true },
          },
        },
        {
          name: 'slack_react',
          description: 'Add a reaction emoji to a Slack message',
          parameters: {
            channel: { type: 'string', description: 'Channel ID', required: true },
            timestamp: { type: 'string', description: 'Message timestamp', required: true },
            emoji: { type: 'string', description: 'Emoji name', required: true },
          },
        },
      ],
      settings: [
        {
          key: 'slack_bot_token',
          label: 'Bot Token',
          type: 'string',
          required: true,
          description: 'Slack bot OAuth token (xoxb-...)',
        },
        {
          key: 'default_channel',
          label: 'Default Channel',
          type: 'string',
          description: 'Default Slack channel for notifications',
        },
      ],
      events: ['agent:completed', 'agent:error'],
      keywords: ['slack', 'notifications', 'messaging', 'chat'],
    },
    {
      id: 'aether-plugin-github',
      name: 'GitHub Actions',
      version: '1.0.0',
      author: 'Aether OS Team',
      description:
        'GitHub integration for creating issues, reviewing PRs, triggering workflows, and accessing repository files.',
      category: 'tools',
      icon: '\u{1F419}',
      tools: [
        {
          name: 'gh_create_issue',
          description: 'Create a GitHub issue',
          parameters: {
            owner: { type: 'string', description: 'Repository owner', required: true },
            repo: { type: 'string', description: 'Repository name', required: true },
            title: { type: 'string', description: 'Issue title', required: true },
            body: { type: 'string', description: 'Issue body' },
          },
        },
        {
          name: 'gh_review_pr',
          description: 'Submit a review on a pull request',
          parameters: {
            owner: { type: 'string', description: 'Repository owner', required: true },
            repo: { type: 'string', description: 'Repository name', required: true },
            pull_number: { type: 'number', description: 'PR number', required: true },
            body: { type: 'string', description: 'Review comment', required: true },
            event: {
              type: 'string',
              description: 'Review event (APPROVE, REQUEST_CHANGES, COMMENT)',
            },
          },
        },
        {
          name: 'gh_trigger_workflow',
          description: 'Trigger a GitHub Actions workflow',
          parameters: {
            owner: { type: 'string', description: 'Repository owner', required: true },
            repo: { type: 'string', description: 'Repository name', required: true },
            workflow_id: { type: 'string', description: 'Workflow ID or filename', required: true },
            ref: { type: 'string', description: 'Branch or tag ref', required: true },
          },
        },
        {
          name: 'gh_get_file',
          description: 'Get a file from a GitHub repository',
          parameters: {
            owner: { type: 'string', description: 'Repository owner', required: true },
            repo: { type: 'string', description: 'Repository name', required: true },
            path: { type: 'string', description: 'File path', required: true },
            ref: { type: 'string', description: 'Branch or commit SHA' },
          },
        },
      ],
      settings: [
        {
          key: 'github_token',
          label: 'GitHub Token',
          type: 'string',
          required: true,
          description: 'GitHub personal access token',
        },
        {
          key: 'default_org',
          label: 'Default Organization',
          type: 'string',
          description: 'Default GitHub organization',
        },
      ],
      keywords: ['github', 'git', 'issues', 'pullrequests', 'actions'],
    },
  ];
}
