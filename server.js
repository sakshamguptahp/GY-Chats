// server.js — a broadcast chat server
//
// What this does differently from the echo server:
// 1. Keeps a list of every connected client
// 2. When one client sends a message, it forwards that message to ALL
//    connected clients (not just back to the sender)
// 3. Messages are sent as JSON so we can include who sent it

const { WebSocketServer } = require('ws');
const Database = require('better-sqlite3');

// Render (and most hosts) assign a port via an environment variable.
// Locally, that variable won't exist, so we fall back to 8080.
const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// Open (or create, if it doesn't exist yet) a SQLite database file on disk
const db = new Database('chat.db');

// Make sure our messages table exists. This only actually creates it
// the very first time the server runs — after that it's a no-op.
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Prepared statements — reusable, efficient queries
const insertMessage = db.prepare('INSERT INTO messages (username, text) VALUES (?, ?)');
const getRecentMessages = db.prepare('SELECT username, text FROM messages ORDER BY id DESC LIMIT 50');

// Keep track of every client currently connected
const clients = new Set();

console.log(`Chat server listening on ws://localhost:${PORT}`);

wss.on('connection', (socket) => {
  clients.add(socket);
  console.log(`Client connected. Total clients: ${clients.size}`);

  // Load the last 50 messages (newest last) and send them to just this client
  const history = getRecentMessages.all().reverse();
  socket.send(JSON.stringify({ type: 'history', messages: history }));

  socket.on('message', (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch (err) {
      console.log('Ignoring non-JSON message');
      return;
    }

    console.log(`${parsed.username}: ${parsed.text}`);

    // Save it to the database before broadcasting
    insertMessage.run(parsed.username, parsed.text);

    const outgoing = JSON.stringify({
      type: 'message',
      username: parsed.username,
      text: parsed.text
    });

    // Send this message to every connected client
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(outgoing);
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`Client disconnected. Total clients: ${clients.size}`);
  });
});
