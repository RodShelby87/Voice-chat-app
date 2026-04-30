const socket = io();

let peer;
let myPeerId;
let localStream;
let isMicOn = false;
let gainNode;
let audioContext;
const activeCalls = {}; // peerId -> call
const remoteAudios = {}; // peerId -> audio element

// --- UI ELEMENTS ---
const themeToggle = document.getElementById('theme-toggle');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const authContainer = document.getElementById('auth-container');
const chatContainer = document.getElementById('chat-container');
const micBtn = document.getElementById('mic-btn');
const chatBox = document.getElementById('chat-box');
const authError = document.getElementById('auth-error');
const roomVolumeSlider = document.getElementById('room-volume');
const myVolumeSlider = document.getElementById('my-volume');
const userListEl = document.getElementById('user-list');

// --- THEME ---
const savedTheme = localStorage.getItem('theme') || 'light';
document.body.setAttribute('data-theme', savedTheme);
themeToggle.addEventListener('click', () => {
    const newTheme = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
});

// --- PEER SETUP ---
function initPeer(callback) {
    peer = new Peer();
    peer.on('open', (id) => {
        myPeerId = id;
        callback();
    });

    peer.on('call', (call) => {
        if (localStream) {
            call.answer(localStream);
            handleRemoteStream(call);
        }
    });
}

// --- ROOM ACTIONS ---
createBtn.addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    if (!username) return showError('Enter your name.');
    initPeer(() => {
        socket.emit('create-room', username, myPeerId, (roomID) => {
            enterRoom(roomID);
        });
    });
});

joinBtn.addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    const roomID = document.getElementById('room-id-input').value.trim().toUpperCase();
    if (!username) return showError('Enter your name.');
    if (!roomID) return showError('Enter a Room ID.');
    initPeer(() => {
        socket.emit('join-room', roomID, username, myPeerId, (res) => {
            if (res.error) return showError(res.error);
            enterRoom(roomID);
        });
    });
});

function enterRoom(roomID) {
    authContainer.style.display = 'none';
    chatContainer.style.display = 'flex';
    document.getElementById('room-display').innerText = `Room: ${roomID}`;
}

function showError(msg) {
    authError.innerText = msg;
    authError.style.display = 'block';
}

// --- MIC ---
micBtn.addEventListener('click', async () => {
    if (!isMicOn) {
        try {
            const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Web Audio API for gain control
            audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(rawStream);
            gainNode = audioContext.createGain();
            gainNode.gain.value = myVolumeSlider.value / 100;
            const dest = audioContext.createMediaStreamDestination();
            source.connect(gainNode);
            gainNode.connect(dest);

            localStream = dest.stream;
            isMicOn = true;
            micBtn.innerText = "🎤 Mic is ON";
            micBtn.style.backgroundColor = "#43b581";

            socket.emit('request-audio-links');
        } catch (err) {
            alert("Mic access denied!");
        }
    } else {
        stopMic();
    }
});

function stopMic() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
        gainNode = null;
    }
    // Close all active calls
    Object.values(activeCalls).forEach(call => call.close());
    Object.keys(activeCalls).forEach(k => delete activeCalls[k]);

    isMicOn = false;
    micBtn.innerText = "🎤 Start Voice";
    micBtn.style.backgroundColor = "";
}

// --- VOLUME SLIDERS ---
roomVolumeSlider.addEventListener('input', () => {
    const vol = roomVolumeSlider.value / 100;
    Object.values(remoteAudios).forEach(audio => audio.volume = vol);
});

myVolumeSlider.addEventListener('input', () => {
    if (gainNode) gainNode.gain.value = myVolumeSlider.value / 100;
});

// --- PEER CALLS ---
socket.on('user-connected', (remotePeerId) => {
    if (!localStream || !isMicOn) return;
    const call = peer.call(remotePeerId, localStream);
    activeCalls[remotePeerId] = call;
    handleRemoteStream(call, remotePeerId);
});

socket.on('user-disconnected', (remotePeerId) => {
    if (activeCalls[remotePeerId]) {
        activeCalls[remotePeerId].close();
        delete activeCalls[remotePeerId];
    }
    if (remoteAudios[remotePeerId]) {
        remoteAudios[remotePeerId].remove();
        delete remoteAudios[remotePeerId];
    }
});

function handleRemoteStream(call, remotePeerId) {
    call.on('stream', (remoteStream) => {
        const audio = document.createElement('audio');
        audio.srcObject = remoteStream;
        audio.volume = roomVolumeSlider.value / 100;
        audio.addEventListener('loadedmetadata', () => audio.play());
        document.getElementById('audio-grid').append(audio);
        if (remotePeerId) remoteAudios[remotePeerId] = audio;
    });
    call.on('close', () => {
        if (remotePeerId && remoteAudios[remotePeerId]) {
            remoteAudios[remotePeerId].remove();
            delete remoteAudios[remotePeerId];
        }
    });
}

// --- USER LIST ---
socket.on('user-list', (users) => {
    userListEl.innerHTML = '';
    users.forEach(u => {
        const li = document.createElement('li');
        li.innerText = u;
        userListEl.appendChild(li);
    });
});

// --- TEXT CHAT ---
document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function sendMessage() {
    const msg = document.getElementById('msg-input').value.trim();
    if (msg) {
        socket.emit('send-message', msg);
        appendMessage(`You: ${msg}`);
        document.getElementById('msg-input').value = '';
    }
}

socket.on('receive-message', (data) => {
    appendMessage(`${data.user}: ${data.msg}`);
});

function appendMessage(text) {
    const div = document.createElement('div');
    div.innerText = text;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}
