import { Client, Account, Databases, Storage } from 'appwrite';

const DEFAULT_APPWRITE_ENDPOINT = 'https://sgp.cloud.appwrite.io/v1';
const windowEndpoint = typeof window !== 'undefined' ? window.__APPWRITE_ENDPOINT__ : undefined;
const envEndpoint = import.meta.env.VITE_APPWRITE_ENDPOINT;
const configuredEndpoint = windowEndpoint || envEndpoint;

const isBrowser = typeof window !== 'undefined';
const isHttpsContext = !isBrowser || window.location.protocol === 'https:';
const isProxyEndpoint = typeof configuredEndpoint === 'string' && configuredEndpoint.startsWith('/appwrite/');

const appwriteEndpoint =
    !isHttpsContext && isProxyEndpoint ? DEFAULT_APPWRITE_ENDPOINT : configuredEndpoint || DEFAULT_APPWRITE_ENDPOINT;

const client = new Client().setEndpoint(appwriteEndpoint).setProject('monochrome-plus');

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

export { client, account, databases, storage };
