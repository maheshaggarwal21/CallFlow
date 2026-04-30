import axios from "axios";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});
