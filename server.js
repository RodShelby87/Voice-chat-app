const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const { v4: uuidv4 } = require('uuid');

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {

    socket.on('create-room', (username, peerId, callback) => {
        const roomID = uuidv4().slice(0, 8).toUpperCase();
        rooms[roomID] = { users: {} };
        joinRoom(socket, roomID, username, peerId);
        callback(roomID);
    });

    socket.on('join-room', (roomID, username, peerId, callback) => {
        if (!rooms[roomID]) return callback({ error: 'Room not found.' });
        joinRoom(socket, roomID, username, peerId);
        callback({ ok: true });
    });

    socket.on('send-message', (message) => {
        const { roomID, username } = socket;
        if (roomID) socket.to(roomID).emit('receive-message', { user: username, msg: message });
    });

    socket.on('request-audio-links', () => {
        socket.to(socket.roomID).emit('user-connected', socket.peerId);
    });

    socket.on('mic-status', (isActive) => {
        const { roomID, peerId } = socket;
        if (roomID && rooms[roomID]) {
            rooms[roomID].users[socket.id].micActive = isActive;
            io.to(roomID).emit('peer-mic-status', { peerId, isActive });
        }
    });

    socket.on('check-room', (roomID, callback) => {
        callback(!!rooms[roomID]);
    });

    socket.on('disconnect', () => {
        const { roomID, username, peerId } = socket;
        if (!roomID || !rooms[roomID]) return;

        delete rooms[roomID].users[socket.id];
        socket.to(roomID).emit('user-disconnected', peerId);
        socket.to(roomID).emit('receive-message', { user: 'System', msg: `${username} left.` });

        const userList = Object.values(rooms[roomID].users);
        io.to(roomID).emit('user-list', userList);

        if (Object.keys(rooms[roomID].users).length === 0) {
            delete rooms[roomID];
        }
    });
});

function joinRoom(socket, roomID, username, peerId) {
    socket.join(roomID);
    socket.username = username;
    socket.roomID = roomID;
    socket.peerId = peerId;

    rooms[roomID].users[socket.id] = { username, peerId, micActive: false };

    socket.to(roomID).emit('receive-message', { user: 'System', msg: `${username} joined the room.` });

    const userList = Object.values(rooms[roomID].users);
    io.to(roomID).emit('user-list', userList);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
