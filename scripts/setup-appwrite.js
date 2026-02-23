import { Client, Databases, Storage, ID, Permission, Role } from 'node-appwrite';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client()
    .setEndpoint('https://sgp.cloud.appwrite.io/v1')
    .setProject('monochrome-plus')
    .setKey(process.env.APPWRITE_API_KEY); // Requires an API key with database permissions

const databases = new Databases(client);
const storage = new Storage(client);

const DATABASE_ID = 'monochrome-plus';
const DATABASE_NAME = 'Monochrome+';

const collections = [
    {
        id: 'DB_users',
        name: 'Users',
        permissions: [
            Permission.read(Role.any()),
            Permission.create(Role.users()),
            Permission.update(Role.users()),
            Permission.delete(Role.users()),
        ],
        documentSecurity: true,
        attributes: [
            { key: 'firebase_id', type: 'string', size: 255, required: true },
            { key: 'username', type: 'string', size: 255, required: true },
            { key: 'display_name', type: 'string', size: 255, required: false },
            { key: 'avatar_url', type: 'string', size: 1000, required: false },
            { key: 'banner', type: 'string', size: 1000, required: false },
            { key: 'status', type: 'string', size: 5000, required: false }, // Store JSON as string
            { key: 'about', type: 'string', size: 5000, required: false },
            { key: 'website', type: 'string', size: 500, required: false },
            { key: 'lastfm_username', type: 'string', size: 255, required: false },
            { key: 'library', type: 'string', size: 65535, required: false, x_large: true }, // Big JSON
            { key: 'history', type: 'string', size: 65535, required: false, x_large: true },
            { key: 'user_playlists', type: 'string', size: 65535, required: false, x_large: true },
            { key: 'user_folders', type: 'string', size: 65535, required: false, x_large: true },
            { key: 'favorite_albums', type: 'string', size: 65535, required: false, x_large: true },
            { key: 'privacy', type: 'string', size: 2000, required: false },
        ],
        indexes: [
            { key: 'idx_firebase_id', attributes: ['firebase_id'], type: 'key' },
            { key: 'idx_username', attributes: ['username'], type: 'unique' },
        ],
    },
    {
        id: 'DB_public_playlists',
        name: 'Public Playlists',
        permissions: [
            Permission.read(Role.any()),
            Permission.create(Role.users()),
            Permission.update(Role.users()),
            Permission.delete(Role.users()),
        ],
        documentSecurity: true,
        attributes: [
            { key: 'id', type: 'string', size: 255, required: true },
            { key: 'owner_id', type: 'string', size: 255, required: true },
            { key: 'name', type: 'string', size: 255, required: true },
            { key: 'description', type: 'string', size: 2000, required: false },
            { key: 'cover', type: 'string', size: 1000, required: false },
            { key: 'tracks', type: 'string', size: 65535, required: false, x_large: true },
            { key: 'is_public', type: 'boolean', required: false, default: true },
        ],
        indexes: [
            { key: 'idx_playlist_id', attributes: ['id'], type: 'key' },
            { key: 'idx_owner', attributes: ['owner_id'], type: 'key' },
        ]
    },
    {
        id: 'DB_friend_requests',
        name: 'Friend Requests',
        permissions: [
            Permission.read(Role.users()),
            Permission.create(Role.users()),
            Permission.update(Role.users()),
            Permission.delete(Role.users()),
        ],
        documentSecurity: true,
        attributes: [
            { key: 'sender_id', type: 'string', size: 255, required: true },
            { key: 'sender_username', type: 'string', size: 255, required: true },
            { key: 'sender_display_name', type: 'string', size: 255, required: false },
            { key: 'sender_avatar', type: 'string', size: 1000, required: false },
            { key: 'receiver_id', type: 'string', size: 255, required: true },
            { key: 'receiver_username', type: 'string', size: 255, required: true },
            { key: 'receiver_display_name', type: 'string', size: 255, required: false },
            { key: 'receiver_avatar', type: 'string', size: 1000, required: false },
            { key: 'status', type: 'string', size: 32, required: true },
            { key: 'created_at', type: 'integer', required: true },
            { key: 'updated_at', type: 'integer', required: true },
        ],
        indexes: [
            { key: 'idx_friend_sender', attributes: ['sender_id'], type: 'key' },
            { key: 'idx_friend_receiver', attributes: ['receiver_id'], type: 'key' },
            { key: 'idx_friend_status', attributes: ['status'], type: 'key' },
            { key: 'idx_friend_created', attributes: ['created_at'], type: 'key' },
        ],
    },
    {
        id: 'DB_chat_messages',
        name: 'Chat Messages',
        permissions: [
            Permission.read(Role.users()),
            Permission.create(Role.users()),
            Permission.update(Role.users()),
            Permission.delete(Role.users()),
        ],
        documentSecurity: true,
        attributes: [
            { key: 'conversation_id', type: 'string', size: 512, required: true },
            { key: 'sender_id', type: 'string', size: 255, required: true },
            { key: 'sender_username', type: 'string', size: 255, required: true },
            { key: 'sender_display_name', type: 'string', size: 255, required: false },
            { key: 'sender_avatar', type: 'string', size: 1000, required: false },
            { key: 'receiver_id', type: 'string', size: 255, required: true },
            { key: 'receiver_username', type: 'string', size: 255, required: true },
            { key: 'receiver_display_name', type: 'string', size: 255, required: false },
            { key: 'receiver_avatar', type: 'string', size: 1000, required: false },
            { key: 'message', type: 'string', size: 5000, required: false },
            { key: 'track_payload', type: 'string', size: 65535, required: false, x_large: true },
            { key: 'created_at', type: 'integer', required: true },
            { key: 'read', type: 'boolean', required: false, default: false },
        ],
        indexes: [
            { key: 'idx_chat_conversation', attributes: ['conversation_id'], type: 'key' },
            { key: 'idx_chat_sender', attributes: ['sender_id'], type: 'key' },
            { key: 'idx_chat_receiver', attributes: ['receiver_id'], type: 'key' },
            { key: 'idx_chat_created', attributes: ['created_at'], type: 'key' },
            { key: 'idx_chat_read', attributes: ['read'], type: 'key' },
        ],
    }
];

async function setup() {
    try {
        console.log('🚀 Starting Appwrite Setup...');

        // 1. Create Database if not exists
        try {
            await databases.get(DATABASE_ID);
            console.log(`✅ Database "${DATABASE_ID}" already exists.`);
        } catch (e) {
            console.log(`Creating database "${DATABASE_ID}"...`);
            await databases.create(DATABASE_ID, DATABASE_NAME);
        }

        // 2. Create Collections
        for (const col of collections) {
            try {
                const existing = await databases.getCollection(DATABASE_ID, col.id);
                console.log(`✅ Collection "${col.id}" already exists. Updating permissions...`);
                await databases.updateCollection(DATABASE_ID, col.id, col.name, col.permissions, col.documentSecurity);
            } catch (e) {
                console.log(`Creating collection "${col.id}"...`);
                await databases.createCollection(DATABASE_ID, col.id, col.name, col.permissions, col.documentSecurity);
            }

            // 3. Create Attributes
            const existingAttrRes = await databases.listAttributes(DATABASE_ID, col.id);
            const existingKeys = existingAttrRes.attributes.map((a) => a.key);

            for (const attr of col.attributes) {
                if (existingKeys.includes(attr.key)) continue;

                console.log(`   Adding attribute "${attr.key}" to "${col.id}"...`);
                const canUseDefault = Object.prototype.hasOwnProperty.call(attr, 'default') && !attr.required;
                if (attr.type === 'string') {
                    if (canUseDefault) {
                        await databases.createStringAttribute(
                            DATABASE_ID,
                            col.id,
                            attr.key,
                            attr.size,
                            attr.required,
                            attr.default
                        );
                    } else {
                        await databases.createStringAttribute(DATABASE_ID, col.id, attr.key, attr.size, attr.required);
                    }
                } else if (attr.type === 'boolean') {
                    if (canUseDefault) {
                        await databases.createBooleanAttribute(
                            DATABASE_ID,
                            col.id,
                            attr.key,
                            attr.required,
                            attr.default
                        );
                    } else {
                        await databases.createBooleanAttribute(DATABASE_ID, col.id, attr.key, attr.required);
                    }
                } else if (attr.type === 'integer') {
                    if (canUseDefault) {
                        await databases.createIntegerAttribute(
                            DATABASE_ID,
                            col.id,
                            attr.key,
                            attr.required,
                            null,
                            null,
                            attr.default
                        );
                    } else {
                        await databases.createIntegerAttribute(DATABASE_ID, col.id, attr.key, attr.required, null, null);
                    }
                }
                // Add sleep to avoid rate limits on cloud
                await new Promise((r) => setTimeout(r, 1000));
            }

            // 4. Create Indexes
            const existingIdxRes = await databases.listIndexes(DATABASE_ID, col.id);
            const existingIdxKeys = existingIdxRes.indexes.map((i) => i.key);

            for (const idx of col.indexes) {
                if (existingIdxKeys.includes(idx.key)) continue;
                console.log(`   Adding index "${idx.key}" to "${col.id}"...`);
                await databases.createIndex(DATABASE_ID, col.id, idx.key, idx.type, idx.attributes);
            }
        }

        // 5. Create Storage Bucket
        const BUCKET_ID = 'profile-images';
        try {
            await storage.getBucket(BUCKET_ID);
            console.log(`✅ Bucket "${BUCKET_ID}" already exists.`);
        } catch (e) {
            console.log(`Creating bucket "${BUCKET_ID}"...`);
            await storage.createBucket(
                BUCKET_ID,
                'Profile Images',
                [
                    Permission.read(Role.any()),
                    Permission.create(Role.users()),
                    Permission.update(Role.users()),
                    Permission.delete(Role.users()),
                ],
                false, // fileSecurity
                true, // enabled
                50000000, // maximumFileSize (50MB)
                ['jpg', 'png', 'jpeg', 'webp', 'gif'], // allowedExtensions
                'none', // compression
                true, // encryption
                true // antivirus
            );
        }

        console.log('✨ Appwrite Infrastructure Setup Complete!');
    } catch (error) {
        console.error('❌ Setup failed:', error);
        if (error.code === 401) {
            console.error('   Hint: Make sure your APPWRITE_API_KEY is correct and has "databases.write" permissions.');
        }
    }
}

setup();
