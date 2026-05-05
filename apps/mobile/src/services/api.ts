import axios from "axios";

// VPS public IP — process.env is always undefined in RN without a Babel plugin,
// so we hardcode the VPS address here. Change port if nginx proxies to a different one.
const API_BASE_URL = "http://168.144.68.199:4000/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // VPS round-trip is slower than LAN
});
