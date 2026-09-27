import { config as loadDotEnv } from 'dotenv';

import { parseEnvironment } from './env.js';

loadDotEnv({ quiet: true });

export const config = parseEnvironment(process.env);
export type Config = typeof config;
