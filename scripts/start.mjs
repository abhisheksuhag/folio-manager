// Production launcher for `npm start`.
//
// Two reasons this file exists instead of an inline npm script:
//  1. There is no cross-platform way to set NODE_ENV in an npm script (`NODE_ENV=x cmd`
//     is not valid on Windows cmd.exe).
//  2. Node's `--env-file` applies .env *before* the entry module runs, so a `.env`
//     carrying NODE_ENV=development would silently downgrade production. We skip
//     --env-file and let server/config.ts load .env via dotenv, which never
//     overwrites variables already present in the environment.
//
// Set NODE_ENV in the real environment (not .env) to override.
process.env.NODE_ENV ??= 'production';
await import(new URL('../dist/server.js', import.meta.url).href);
