const socket = io();
const peer = new Peer(); 

let myPeerId;
let localStream;
let isMicOn = false;

// --- UI ELEMENTS ---
const themeToggle = document.getElementById('theme-toggle');
const joinBtn = document.getElementById('join-btn');
const authContainer = document.getElementById('auth-container');
const chatContainer = document.getElementById('chat-container');
const micBtn = document.getElementById('mic-btn');
const chatBox = document.getElementById('chat-box');

// --- THEME LOGIC ---
const savedTheme = localStorage.getItem('theme') || 'light';
document.body.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
    const newTheme = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
});

// --- PEER INITIALIZATION ---
peer.on('open', (id) => {
    myPeerId = id;
});

// Listen for incoming calls
peer.on('call', (call) => {
    // Only answer if our own mic is on
    if (localStream) {
        call.answer(localStream);
        const audio = document.createElement('audio');
        call.on('stream', (remoteStream) => {
            addAudioStream(audio, remoteStream);
        });
    }
});

// --- ROOM & VOICE LOGIC ---
joinBtn.addEventListener('click', () => {
    const username = document.getElementById('username').value;
    const roomID = document.getElementById('room-id').value;

    if (username && roomID) {
        socket.emit('join-room', roomID, username, myPeerId);
        authContainer.style.display = 'none';
        chatContainer.style.display = 'flex';
        document.getElementById('room-display').innerText = `Room: ${roomID}`;
    }
});

micBtn.addEventListener('click', async () => {
    if (!isMicOn) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isMicOn = true;
            micBtn.innerText = "🎤 Mic is ON";
            micBtn.style.backgroundColor = "#43b581"; // Active Green
            
            // Tell the server we are ready to exchange audio
            socket.emit('request-audio-links');
        } catch (err) {
            alert("Mic access denied!");
        }
    } else {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        isMicOn = false;
        micBtn.innerText = "🎤 Start Voice";
        micBtn.style.backgroundColor = "";
    }
});

// Triggered when someone else turns their mic on
socket.on('user-connected', (remotePeerId) => {
    if (localStream && isMicOn) {
        const call = peer.call(remotePeerId, localStream);
        const audio = document.createElement('audio');
        call.on('stream', (remoteStream) => {
            addAudioStream(audio, remoteStream);
        });
    }
});

function addAudioStream(audio, stream) {
    audio.srcObject = stream;
    audio.addEventListener('loadedmetadata', () => {
        audio.play();
    });
    document.getElementById('audio-grid').append(audio);
}

// --- TEXT CHAT ---
document.getElementById('send-btn').addEventListener('click', () => {
    const msg = document.getElementById('msg-input').value;
    if (msg) {
        socket.emit('send-message', msg);
        appendMessage(`You: ${msg}`);
        document.getElementById('msg-input').value = '';
    }
});

socket.on('receive-message', (data) => {
    appendMessage(`${data.user}: ${data.msg}`);
});

function appendMessage(text) {
    const div = document.createElement('div');
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}