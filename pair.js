const { create } = require('./session');
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
const router = express.Router();
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    const dir = './temp/' + id;
    let num = (req.query.number || '').toString().replace(/[^0-9]/g, '');
    let finished = false;
    let codeSent = false;
    let attempts = 0;

    if (!num) return res.status(400).send({ code: "Number required" });

    const fail = (msg) => {
        finished = true;
        removeFile(dir);
        if (!res.headersSent) res.send({ code: msg });
    };

    async function getPaire() {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const logger = pino({ level: "fatal" }).child({ level: "fatal" });
        try {
            let version;
            try {
                ({ version } = await fetchLatestBaileysVersion());
            } catch (e) {
                console.log('version fetch failed, using default');
            }

            const session = makeWASocket({
                ...(version ? { version } : {}),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.macOS("Safari"),
            });

            session.ev.on('creds.update', saveCreds);

            // qr-inu wait cheyyathe udane pairing code request cheyyunnu
            if (!session.authState.creds.registered && !codeSent) {
                await delay(3000);
                try {
                    const code = await session.requestPairingCode(num);
                    codeSent = true;
                    if (!res.headersSent) res.send({ code });
                } catch (err) {
                    console.log("pairing code error:", err && err.message);
                    return fail("Service Unavailable: " + (err && err.message));
                }
            }

            session.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection === "open") {
                    try {
                        await delay(5000);
                        const jsonData = await fs.promises.readFile(`${dir}/creds.json`, 'utf-8');
                        const { id: data } = await create(jsonData);
                        await session.sendMessage(session.user.id, { text: 'bot~' + data });
                        await delay(1000);
                    } catch (err) {
                        console.log("save session error:", err && err.message);
                    }
                    finished = true;
                    try { await session.ws.close(); } catch (e) {}
                    removeFile(dir);
                } else if (connection === "close" && !finished) {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    console.log("connection closed, status:", code);
                    if (code === 401 || code === 403) return fail("WhatsApp refused connection (" + code + ")");
                    if (++attempts > 6) return fail("Connection failed, try again");
                    await delay(3000);
                    getPaire();
                }
            });
        } catch (err) {
            console.log("pair error:", err && (err.stack || err.message || err));
            fail("Service Unavailable: " + (err && err.message));
        }
    }

    return await getPaire();
});

module.exports = router;
