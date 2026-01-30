import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export async function createInstallationClient(installationId: number): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GitHub App credentials not configured');
  }

  const auth = createAppAuth({
    appId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  });

  const installationAuth = await auth({
    type: 'installation',
    installationId,
  });

  return new Octokit({
    auth: installationAuth.token,
  });
}
