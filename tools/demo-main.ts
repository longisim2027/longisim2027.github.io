// Page entry for the Pages build. ES modules evaluate in import order, so the
// shim (worker + /v1 routing + banner) is fully installed before the app's own,
// unmodified entry point runs. Both land in one chunk: no extra round trip.
import './demo-entry';
import '/src/main.tsx';
