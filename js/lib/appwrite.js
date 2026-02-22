import { Client, Account, Databases, Storage } from 'appwrite';

const client = new Client().setEndpoint('https://sgp.cloud.appwrite.io/v1').setProject('monochrome-plus');

const account = new Account(client);
const databases = new Databases(client);
const storage = new Storage(client);

export { client, account, databases, storage };
