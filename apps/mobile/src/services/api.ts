import axios from "axios";

// 192.168.29.184 = Mac LAN IP — Android devices/emulators cannot use localhost
const API_BASE_URL = process.env.API_BASE_URL || "http://192.168.29.184:4000/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});
