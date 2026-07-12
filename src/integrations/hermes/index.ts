export { HermesRunsClient } from '../../../packages/core/src/hermes-client.js';
export const WHITEBOX_PROMPT_VERSION='whitebox-agency-v2-polyglot';
export function hermesConfigFromEnvironment(env:Record<string,string|undefined>){return {baseUrl:env.HERMES_SERVER_URL??'http://127.0.0.1:8642',key:env.HERMES_SERVER_KEY,environment:env.NODE_ENV};}
