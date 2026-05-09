import axios from "axios";

// VPS API hostname — process.env is always undefined in RN without a Babel plugin.
const API_BASE_URL = "https://api-callflow.thexpertshair.com/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // VPS round-trip is slower than LAN
});
