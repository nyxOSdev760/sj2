// Loads settings such as PORT from a .env file next to package.json, if there
// is one. Imported first so other modules see the values. (.env is git-ignored.)
try {
	process.loadEnvFile?.(new URL("../.env", import.meta.url));
} catch {
	// no .env file
}
