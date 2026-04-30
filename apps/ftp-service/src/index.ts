import dotenv from "dotenv";
import { pollFtpOnce } from "./ftpPoller";

dotenv.config();

const intervalMs = Number(process.env.FTP_POLL_INTERVAL_MS || 15 * 60 * 1000);

function shouldRunNow() {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const isBusinessDay = day >= 1 && day <= 6; // Mon-Sat
  const inHours = hour >= 9 && hour <= 18;
  return isBusinessDay && inHours;
}

async function runOnce() {
  if (!shouldRunNow()) {
    return;
  }
  try {
    await pollFtpOnce();
  } catch (err) {
    console.error("FTP poll failed", err);
  }
}

runOnce();
setInterval(runOnce, intervalMs);
