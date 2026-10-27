import path from "node:path";
import dotenv from "dotenv";

if (process.env.APP_DATA_DIR) {
  dotenv.config({ path: path.resolve(process.env.APP_DATA_DIR, ".env") });
}
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
