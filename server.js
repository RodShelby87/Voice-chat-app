const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

io.on('connection', (socket) => {
    socket.on('join-room', (roomID, username, peerId) => {
        socket.join(roomID);
        socket.username = username;
        socket.roomID = roomID;
        socket.peerId = peerId;

        // Notify others in the room that a new user joined
        socket.to(roomID).emit('receive-message', {
            user: 'System',
            msg: `${username} joined the room.`
        });

        // Handle text messages
        socket.on('send-message', (message) => {
            socket.to(roomID).emit('receive-message', {
                user: socket.username,
                msg: message
            });
        });

        // When a user activates their mic, tell others to connect
        socket.on('request-audio-links', () => {
            socket.to(roomID).emit('user-connected', socket.peerId);
        });

        socket.on('disconnect', () => {
            socket.to(roomID).emit('receive-message', {
                user: 'System',
                msg: `${socket.username} left.`
            });
        });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));