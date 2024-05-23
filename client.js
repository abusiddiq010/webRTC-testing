const userIdElement = document.getElementById("userId");
const userSelect = document.getElementById("userSelect");
const messageInput = document.getElementById("messageInput");
const connectButton = document.getElementById("connectButton");
const messageBox = document.getElementById("messageBox");
const localVideoEl = document.querySelector("#local-video");
const remoteVideoEl = document.querySelector("#remote-video");
const callButton = document.querySelector("#callButton");

let localStream;
let remoteStream;
let peerConnection;
let didIOffer = false;

let peerConfiguration = {
  iceServers: [
    {
      urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
    },
  ],
};

let userId = null;
let users = [];
let messages = [];

const ws = new WebSocket("wss://hilarious-tranquil-meerkat.glitch.me");

ws.onopen = () => {
  console.log("Connected to WebSocket server");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "connection":
      userId = data.userId;
      users = data.users;
      userIdElement.textContent = userId;

      updateUsersDropdown();
      break;
    case "user_connected":
      users.push(data.userId);
      updateUsersDropdown();
      break;
    case "user_disconnected":
      users = users.filter((id) => id !== data.userId);
      updateUsersDropdown();
      break;
    case "forwarded":
      messages.push(data);
      updateMessageBox();
      handleForwardedMessage(data);
      break;
    default:
      console.error("Unknown message type:", data.type);
  }
};


function handleForwardedMessage(data) {
  console.log(data)
  if (data.offer) {
    console.log("Received offer");
    answerCall(data);
  } else if (data.answer) {
    console.log("Received answer");
    addAnswer(data);
  } else if (data.iceCandidate) {
    console.log("Received ICE candidate");
    addNewIceCandidate(data.iceCandidate);
  }
}


connectButton.addEventListener("click", () => {
  const selectedUser = userSelect.value;
  const message = messageInput.value;

  if (selectedUser && message) {
    ws.send(
      JSON.stringify({
        method: "forward",
        to: selectedUser,
        message: message,
      })
    );
    messageInput.value = "";
  } else {
    alert("Please select a user and enter a message.");
  }
});

function updateUsersDropdown() {
  userSelect.innerHTML = "";
  users.forEach((user) => {
    const option = document.createElement("option");
    option.value = user;
    option.textContent = user;
    userSelect.appendChild(option);
  });
}

function updateMessageBox() {
  messageBox.innerHTML = "";
  messages.forEach((message) => {
    const messageElement = document.createElement("div");
    messageElement.textContent = `${message.from}: ${message.message}`;
    messageBox.appendChild(messageElement);
  });
}

// WebRTC Part

async function makeCall() {
  await fetchUserMedia();

  //peerConnection is all set with our STUN servers sent over
  await createPeerConnection();

  //create offer time!
  try {
    console.log("Creating offer...");
    const offer = await peerConnection.createOffer();
    console.log(offer);
    peerConnection.setLocalDescription(offer);
    didIOffer = true;
    ws.send(
      JSON.stringify({
        method: "forward",
        to: userSelect.value,
        offer: offer,
      })
    );
  } catch (err) {
    console.log(err);
  }
}
async function answerCall(offerObj) {
  await fetchUserMedia();
  await createPeerConnection(offerObj);
  const answer = await peerConnection.createAnswer({}); //just to make the docs happy
  await peerConnection.setLocalDescription(answer); //this is CLIENT2, and CLIENT2 uses the answer as the localDesc
  console.log(offerObj);
  console.log(answer);
  // console.log(peerConnection.signalingState) //should be have-local-pranswer because CLIENT2 has set its local desc to it's answer (but it won't be)
  //add the answer to the offerObj so the server knows which offer this is related to
  offerObj.answer = answer;
  //emit the answer to the signaling server, so it can emit to CLIENT1
  //expect a response from the server with the already existing ICE candidates
  // const offerIceCandidates = await socket.emitWithAck("newAnswer", offerObj);

  ws.send(
    JSON.stringify({
      method: "forward",
      to: userSelect.value,
      answer: answer,
    })
  );
}

const addAnswer = async (offerObj) => {
  //addAnswer is called in socketListeners when an answerResponse is emitted.
  //at this point, the offer and answer have been exchanged!
  //now CLIENT1 needs to set the remote
  await peerConnection.setRemoteDescription(offerObj.answer);
  // console.log(peerConnection.signalingState)
};

const fetchUserMedia = () => {
  return new Promise(async (resolve, reject) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        // audio: true,
      });
      localVideoEl.srcObject = stream;
      localStream = stream;
      resolve();
    } catch (err) {
      console.log(err);
      reject();
    }
  });
};


const createPeerConnection = (offerObj) => {
  return new Promise(async (resolve, reject) => {
    //RTCPeerConnection is the thing that creates the connection
    //we can pass a config object, and that config object can contain stun servers
    //which will fetch us ICE candidates
    peerConnection = await new RTCPeerConnection(peerConfiguration);
    remoteStream = new MediaStream();
    remoteVideoEl.srcObject = remoteStream;

    localStream.getTracks().forEach((track) => {
      //add localtracks so that they can be sent once the connection is established
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.addEventListener("signalingstatechange", (event) => {
      console.log(event);
      console.log(peerConnection.signalingState);
    });

    peerConnection.addEventListener("icecandidate", (e) => {
      console.log("........Ice candidate found!......");
      console.log(e);
      if (e.candidate) {
        ws.send(
          JSON.stringify({
            method: "forward",
            to: userSelect.value,
            iceCandidate: e.candidate,
          })
        );
      }
    });

    peerConnection.addEventListener("track", (e) => {
      console.log("Got a track from the other peer!! How excting");
      console.log(e);
      e.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track, remoteStream);
        console.log("Here's an exciting moment... fingers cross");
      });
    });

    if (offerObj) {
      //this won't be set when called from call();
      //will be set when we call from answerOffer()
      // console.log(peerConnection.signalingState) //should be stable because no setDesc has been run yet
      await peerConnection.setRemoteDescription(offerObj.offer);
      // console.log(peerConnection.signalingState) //should be have-remote-offer, because client2 has setRemoteDesc on the offer
    }
    resolve();
  });
};

const addNewIceCandidate = (iceCandidate) => {
 if(peerConnection && peerConnection.remoteDescription){
   peerConnection.addIceCandidate(iceCandidate);
   console.log("======Added Ice Candidate======");
  }
};



callButton.addEventListener("click", makeCall);
