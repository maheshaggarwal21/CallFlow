import dotenv from "dotenv";
import { startFtpServer } from "./ftpServer";

dotenv.config();

console.log("🚀 CallFlow Korecall FTP Receiver starting...");
startFtpServer();
