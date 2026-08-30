import { writeFileSync, readFileSync, existsSync } from 'fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const cfg = {
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
  databaseURL:       process.env.FIREBASE_DATABASE_URL,
  projectId:         process.env.FIREBASE_PROJECT_ID,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
  measurementId:     process.env.FIREBASE_MEASUREMENT_ID
};

const missing = Object.entries(cfg).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error('Missing config values:', missing.join(', '));
  process.exit(1);
}

writeFileSync(
  'firebase-config.js',
  '// AUTO-GENERATED - do not edit, do not commit.\n' +
  'const firebaseConfig = ' + JSON.stringify(cfg, null, 2) + ';\n'
);
console.log('firebase-config.js generated');
