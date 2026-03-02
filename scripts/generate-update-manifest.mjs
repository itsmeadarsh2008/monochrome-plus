import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const appConfigPath = path.join(rootDir, 'neutralino.config.json');
const desktopDistPath = path.join(rootDir, 'desktop-dist');
const releaseAssetsPath = path.join(rootDir, 'release-assets');

async function findResourcesNeu(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = await findResourcesNeu(fullPath);
            if (found) return found;
        } else if (entry.isFile() && entry.name === 'resources.neu') {
            return fullPath;
        }
    }
    return null;
}

async function main() {
    const refName = process.env.GITHUB_REF_NAME || '';
    const versionFromTag = refName.startsWith('v') ? refName.slice(1) : refName;

    const configRaw = await fs.readFile(appConfigPath, 'utf8');
    const config = JSON.parse(configRaw);
    const version = versionFromTag || config.version;
    const tagName = `v${version}`;

    if (!config.applicationId) {
        throw new Error('neutralino.config.json is missing applicationId.');
    }

    const resourcesNeuPath = await findResourcesNeu(desktopDistPath);
    if (!resourcesNeuPath) {
        throw new Error(`Unable to find resources.neu under ${desktopDistPath}`);
    }

    await fs.mkdir(releaseAssetsPath, { recursive: true });

    const updateResourceFileName = `monochrome-plus-${version}.resources.neu`;
    const updateResourcePath = path.join(releaseAssetsPath, updateResourceFileName);
    await fs.copyFile(resourcesNeuPath, updateResourcePath);

    const repo = process.env.GITHUB_REPOSITORY || 'itsmeadarsh2008/monochrome-plus';
    const resourcesURL = `https://github.com/${repo}/releases/download/${tagName}/${updateResourceFileName}`;

    const manifest = {
        applicationId: config.applicationId,
        version,
        resourcesURL,
        data: {
            channel: 'stable',
            releaseTag: tagName,
        },
    };

    const manifestPath = path.join(releaseAssetsPath, 'latest.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');

    console.log(`Update resource: ${updateResourcePath}`);
    console.log(`Update manifest: ${manifestPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
