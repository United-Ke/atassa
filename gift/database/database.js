const config = require("../../config");
const Sequelize = require("sequelize");
const fs = require("fs");
const path = require("path");

class DatabaseManager {
    static instance = null;

    static getInstance() {
        if (!DatabaseManager.instance) {
            const DATABASE_URL = config.DATABASE_URL;
            const DEFAULT_SQLITE_PATH = path.join(__dirname, "database.db");

            // =========================================================
            // SQLITE FALLBACK
            // =========================================================
            if (!DATABASE_URL) {
                console.log("ℹ️ DATABASE_URL is empty, using SQLite...");

                const dbDir = path.dirname(DEFAULT_SQLITE_PATH);

                if (!fs.existsSync(dbDir)) {
                    fs.mkdirSync(dbDir, {
                        recursive: true,
                    });
                }

                DatabaseManager.instance = new Sequelize({
                    dialect: "sqlite",
                    storage: DEFAULT_SQLITE_PATH,
                    logging: false,

                    pool: {
                        max: 1,
                        min: 0,
                        acquire: 30000,
                        idle: 10000,
                    },

                    retry: {
                        max: 5,
                    },

                    dialectOptions: {
                        busyTimeout: 30000,
                    },
                });

            // =========================================================
            // POSTGRESQL / AIVEN / RENDER / NEON
            // =========================================================
            } else {
                console.log("🗄️ DATABASE_URL detected.");
                console.log("🔗 Connecting to PostgreSQL...");

                DatabaseManager.instance = new Sequelize(
                    DATABASE_URL,
                    {
                        dialect: "postgres",
                        protocol: "postgres",
                        logging: false,

                        // PostgreSQL SSL configuration
                        dialectOptions: {
                            ssl: {
                                require: true,
                                rejectUnauthorized: false,
                            },
                        },

                        // Keep the connection count low
                        // to work well with free PostgreSQL plans.
                        pool: {
                            max: 5,
                            min: 0,
                            acquire: 30000,
                            idle: 10000,
                        },

                        retry: {
                            max: 5,
                        },

                        // Connection timeout
                        connectTimeout: 30000,
                    }
                );
            }
        }

        return DatabaseManager.instance;
    }
}

const DATABASE = DatabaseManager.getInstance();


// =========================================================
// TEST DATABASE CONNECTION
// =========================================================
async function testDatabaseConnection() {
    try {
        await DATABASE.authenticate();

        console.log("✅ Database connection successful.");

        return true;
    } catch (error) {
        console.error("❌ Database connection failed.");
        console.error("Error:", error.message);

        return false;
    }
}


// =========================================================
// SYNCHRONIZE DATABASE
// =========================================================
async function syncDatabase() {
    try {
        await DATABASE.authenticate();

        console.log("✅ Database connection verified.");

        await DATABASE.sync();

        console.log("✅ Database Synchronized.");

        return true;
    } catch (error) {
        console.error(
            "❌ Error synchronizing the database:",
            error.message
        );

        throw error;
    }
}


module.exports = {
    DATABASE,
    syncDatabase,
    testDatabaseConnection,
};
