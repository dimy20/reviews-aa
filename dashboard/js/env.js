// Values that change per deployment. In Docker this file is overwritten on startup
// from the container's env vars (dashboard/docker/40-env.sh). Empty = demo mode.
export const ENV = {
  API_BASE: 'http://127.0.0.1:8000',
};
