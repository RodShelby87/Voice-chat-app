const socket = io();

// --- PEER: created once, never recreated ---
const peer = new Peer();
let myPeerId;

peer.on('open', (id) => {
    myPeerId = id;
    checkLastRoom();
});

let localStream = null;
let rawStream = null;
let audioContext = null;
let gainNode = null;
let isMicOn = false;
let isMuted = false;

const activeCalls = {};   // peerId -> call
const remoteAudios = {};  // peerId -> audio element

// --- UI ---
const themeToggle     = document.getElementById('theme-toggle');
const createBtn       = document.getElementById('create-btn');
const joinBtn         = document.getElementById('join-btn');
const authContainer   = document.getElementById('auth-container');
const chatContainer   = document.getElementById('chat-container');
const micBtn          = document.getElementById('mic-btn');
const muteBtn         = document.getElementById('mute-btn');
const chatBox         = document.getElementById('chat-box');
const authError       = document.getElementById('auth-error');
const roomVolumeSlider = document.getElementById('room-volume');
const myVolumeSlider  = document.getElementById('my-volume');
const userListEl      = document.getElementById('user-list');
const lastRoomContainer = document.getElementById('last-room-container');
const rejoinBtn       = document.getElementById('rejoin-btn');
const leaveBtn        = document.getElementById('leave-btn');

// --- THEME ---
const savedTheme = localStorage.getItem('theme') || 'light';
document.body.setAttribute('data-theme', savedTheme);
themeToggle.addEventListener('click', () => {
    const newTheme = document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
});

// --- LAST ROOM ---
function checkLastRoom() {
    const lastRoom = localStorage.getItem('lastRoom');
    if (!lastRoom) return;
    socket.emit('check-room', lastRoom, (exists) => {
        if (exists) {
            rejoinBtn.innerText = `↩️ Rejoin ${lastRoom}`;
            lastRoomContainer.style.display = 'block';
        } else {
            localStorage.removeItem('lastRoom');
        }
    });
}

rejoinBtn.addEventListener('click', () => {
    const roomID = localStorage.getItem('lastRoom');
    const username = document.getElementById('username').value.trim();
    if (!username) return showError('Enter your name to rejoin.');
    doJoin(roomID, username);
});

// --- ROOM ACTIONS ---
createBtn.addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    if (!username) return showError('Enter your name.');
    socket.emit('create-room', username, myPeerId, (roomID) => {
        enterRoom(roomID);
    });
});

joinBtn.addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    const roomID = document.getElementById('room-id-input').value.trim().toUpperCase();
    if (!username) return showError('Enter your name.');
    if (!roomID) return showError('Enter a Room ID.');
    doJoin(roomID, username);
});

function doJoin(roomID, username) {
    socket.emit('join-room', roomID, username, myPeerId, (res) => {
        if (res.error) return showError(res.error);
        enterRoom(roomID);
    });
}

function enterRoom(roomID) {
    localStorage.setItem('lastRoom', roomID);
    authContainer.style.display = 'none';
    chatContainer.style.display = 'flex';
    document.getElementById('room-display').innerText = `Room: ${roomID}`;
    authError.style.display = 'none';
}

function showError(msg) {
    authError.innerText = msg;
    authError.style.display = 'block';
}

// --- LEAVE ---
leaveBtn.addEventListener('click', () => {
    stopMic();
    socket.disconnect();
    socket.connect(); // reconnect socket for potential future use
    chatContainer.style.display = 'none';
    authContainer.style.display = 'flex';
    userListEl.innerHTML = '';
    chatBox.innerHTML = '';
    checkLastRoom();
});

// --- MIC START/STOP ---
micBtn.addEventListener('click', async () => {
    if (!isMicOn) {
        try {
            rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(rawStream);
            gainNode = audioContext.createGain();
            gainNode.gain.value = myVolumeSlider.value / 100;
            const dest = audioContext.createMediaStreamDestination();
            source.connect(gainNode);
            gainNode.connect(dest);
            localStream = dest.stream;

            isMicOn = true;
            isMuted = false;
            micBtn.innerText = "🎤 Mic is ON";
            micBtn.classList.add('mic-active');
            muteBtn.innerText = '🔇';
            muteBtn.classList.remove('muted');

            socket.emit('mic-status', true);
            socket.emit('request-audio-links');
        } catch (err) {
            alert("Mic access denied!");
        }
    } else {
        stopMic();
    }
});

function stopMic() {
    if (rawStream) {
        rawStream.getTracks().forEach(t => t.stop());
        rawStream = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
        gainNode = null;
    }
    localStream = null;
    Object.values(activeCalls).forEach(call => call.close());
    Object.keys(activeCalls).forEach(k => delete activeCalls[k]);

    isMicOn = false;
    isMuted = false;
    micBtn.innerText = "🎤 Start Voice";
    micBtn.classList.remove('mic-active');
    muteBtn.innerText = '🔇';
    muteBtn.classList.remove('muted');

    socket.emit('mic-status', false);
}

// --- MUTE TOGGLE ---
muteBtn.addEventListener('click', () => {
    if (!isMicOn) return;
    isMuted = !isMuted;
    if (gainNode) {
        gainNode.gain.value = isMuted ? 0 : myVolumeSlider.value / 100;
    }
    muteBtn.innerText = isMuted ? '🔈' : '🔇';
    muteBtn.classList.toggle('muted', isMuted);
    socket.emit('mic-status', !isMuted);
});

// --- VOLUME SLIDERS ---
roomVolumeSlider.addEventListener('input', () => {
    const vol = roomVolumeSlider.value / 100;
    Object.values(remoteAudios).forEach(audio => { audio.volume = vol; });
});

myVolumeSlider.addEventListener('input', () => {
    if (gainNode && !isMuted) gainNode.gain.value = myVolumeSlider.value / 100;
});

// --- PEER CALLS ---
peer.on('call', (call) => {
    if (localStream) {
        call.answer(localStream);
        handleRemoteStream(call, null);
    }
});

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
        // Avoid duplicate audio elements
        if (remotePeerId && remoteAudios[remotePeerId]) {
            remoteAudios[remotePeerId].remove();
        }
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
        li.dataset.peerId = u.peerId;
        li.innerHTML = `<span class="mic-dot">${u.micActive ? '🟢' : '🔴'}</span> ${u.username}`;
        userListEl.appendChild(li);
    });
});

socket.on('peer-mic-status', ({ peerId, isActive }) => {
    const li = userListEl.querySelector(`[data-peer-id="${peerId}"]`);
    if (li) li.querySelector('.mic-dot').innerText = isActive ? '🟢' : '🔴';
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
