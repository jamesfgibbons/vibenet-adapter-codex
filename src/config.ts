export function requireLiveReferenceKey(environment: NodeJS.ProcessEnv): string {
  const key = environment.VIBENET_REFERENCE_KEY;
  if (!key || key.length < 16) {
    throw new Error("Live normalization requires a local reference key.");
  }
  return key;
}
