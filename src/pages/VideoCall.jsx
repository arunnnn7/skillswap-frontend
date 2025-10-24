import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import API from '../lib/api';
import { io } from 'socket.io-client';

export default function VideoCall() {
  const { roomId } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();

  const searchParams = new URLSearchParams(loc.search);
  const qsMatchId = searchParams.get('matchId');
  const qsPartnerName = searchParams.get('partnerName');
  const qsIsCaller = searchParams.get('isCaller');

  const [callState, setCallState] = useState({
    matchId: loc.state?.matchId || qsMatchId,
    partner: loc.state?.partner || (qsPartnerName ? { name: qsPartnerName } : { name: 'Partner' }),
    isCaller: loc.state?.isCaller || (qsIsCaller === 'true')
  });

  const localRef = useRef();
  const remoteRef = useRef();
  const pcRef = useRef();
  const socketRef = useRef();
  const localStreamRef = useRef();
  const connectionTimeoutRef = useRef();
  const retryCountRef = useRef(0);
  const pendingRemoteCandidatesRef = useRef([]);

  const [status, setStatus] = useState('Initializing...');
  const [rating, setRating] = useState(5);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [duration, setDuration] = useState('00:00');
  const [mediaError, setMediaError] = useState('');
  const [partnerName, setPartnerName] = useState(callState.partner?.name || 'Partner');
  const [audioTestMode, setAudioTestMode] = useState(false);

  const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'https://skillswap-backend-w0b7.onrender.com';

  // Get valid user ID
  const getValidUserId = () => {
    let userId = localStorage.getItem('userId');
    
    if (!userId || userId === 'undefined' || userId === 'null') {
      const userData = localStorage.getItem('user');
      if (userData) {
        try {
          const user = JSON.parse(userData);
          if (user && user._id) {
            localStorage.setItem('userId', user._id);
            return user._id;
          }
        } catch (e) {}
      }
      const tempUserId = 'user-' + Date.now();
      localStorage.setItem('userId', tempUserId);
      return tempUserId;
    }
    
    return userId;
  };

  // Initialize media
  const initializeMedia = async () => {
    try {
      setStatus('Getting camera and microphone...');
      
      // First, check available devices
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      
      console.log('🎤 Available audio inputs:', audioInputs.length);
      console.log('📹 Available video inputs:', videoInputs.length);
      audioInputs.forEach((device, index) => {
        console.log(`Audio ${index}:`, device.label || `Microphone ${index + 1}`, device.deviceId);
      });
      
      // Try to get media with specific audio constraints
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 1 }
          }
        });
      } catch (error) {
        console.warn('Failed with specific audio constraints, trying basic audio:', error);
        // Fallback to basic audio constraints
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: true
        });
      }
      
      localStreamRef.current = stream;
      
      // Debug the obtained stream
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      console.log('🎵 Obtained audio tracks:', audioTracks.length);
      console.log('📹 Obtained video tracks:', videoTracks.length);
      
      audioTracks.forEach((track, index) => {
        console.log(`Audio track ${index}:`, {
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted,
          settings: track.getSettings()
        });
      });
      
      if (localRef.current) {
        localRef.current.srcObject = stream;
        localRef.current.play().catch(console.error);
      }
      
      setStatus('Media ready');
      return stream;
      
    } catch (error) {
      console.error('Media error:', error);
      setMediaError(`Camera/microphone access denied: ${error.message}`);
      setStatus('Media Error');
      throw error;
    }
  };

  // Initialize WebRTC - ENHANCED WITH BETTER ICE HANDLING
  const initializeWebRTC = async (stream) => {
    try {
      setStatus('Setting up connection...');

      const pc = new RTCPeerConnection({
        iceServers: [
          // Primary STUN servers
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          // Additional STUN servers for better connectivity
          { urls: 'stun:stun.stunprotocol.org:3478' },
          { urls: 'stun:stun.ekiga.net' },
          { urls: 'stun:stun.ideasip.com' },
          // TURN servers for NAT traversal
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          },
          {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ],
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      pcRef.current = pc;

      // Add local tracks with explicit audio/video handling
      const audioTracks = stream.getAudioTracks();
      const videoTracks = stream.getVideoTracks();
      
      console.log('🎵 Audio tracks:', audioTracks.length);
      console.log('📹 Video tracks:', videoTracks.length);
      
      // Ensure we have both audio and video tracks
      if (audioTracks.length === 0) {
        console.warn('⚠️ No audio tracks found in stream!');
      }
      if (videoTracks.length === 0) {
        console.warn('⚠️ No video tracks found in stream!');
      }
      
      // Add audio track first to ensure it's included in SDP
      audioTracks.forEach(track => {
        console.log('Adding audio track:', track.label, track.enabled, track.readyState);
        pc.addTrack(track, stream);
        
        // Monitor audio track state changes
        track.addEventListener('mute', () => {
          console.warn('🔇 Audio track muted!', track.label);
        });
        
        track.addEventListener('unmute', () => {
          console.log('🔊 Audio track unmuted!', track.label);
        });
        
        track.addEventListener('ended', () => {
          console.error('❌ Audio track ended!', track.label);
        });
      });
      
      // Add video track
      videoTracks.forEach(track => {
        console.log('Adding video track:', track.label, track.enabled, track.readyState);
        pc.addTrack(track, stream);
      });
      
      // Wait a moment for tracks to be properly added
      await new Promise(resolve => setTimeout(resolve, 100));

      // Handle incoming remote stream - FIXED
      pc.ontrack = (event) => {
        console.log('✅ Received remote stream');
        const remoteStream = event.streams[0];
        
        // Debug remote stream tracks
        const remoteAudioTracks = remoteStream.getAudioTracks();
        const remoteVideoTracks = remoteStream.getVideoTracks();
        console.log('🎵 Remote audio tracks:', remoteAudioTracks.length);
        console.log('📹 Remote video tracks:', remoteVideoTracks.length);
        
        remoteAudioTracks.forEach(track => {
          console.log('Remote audio track:', track.label, track.enabled, track.readyState);
        });
        
        if (remoteRef.current && remoteStream) {
          remoteRef.current.srcObject = remoteStream;
          remoteRef.current.onloadedmetadata = () => {
            remoteRef.current.play().catch(console.error);
          };
          setStatus('Connected ✅');
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current?.connected) {
          socketRef.current.emit('webrtc-signal', {
            roomId,
            type: 'candidate',
            candidate: event.candidate
          });
        }
      };

      // Enhanced connection state handling
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('🔗 Connection state:', state);
        
        if (state === 'connected') {
          setStatus('Connected ✅');
          clearTimeout(connectionTimeoutRef.current);
        } else if (state === 'connecting') {
          setStatus('Connecting...');
        } else if (state === 'disconnected') {
          setStatus('Disconnected - Attempting reconnect...');
          handleReconnect();
        } else if (state === 'failed') {
          setStatus('Connection failed - Retrying...');
          handleReconnect();
        } else if (state === 'closed') {
          setStatus('Connection closed');
        }
      };

      // Enhanced ICE connection state monitoring
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        console.log('🧊 ICE state:', iceState);
        
        if (iceState === 'connected' || iceState === 'completed') {
          setStatus('Connected ✅');
          clearTimeout(connectionTimeoutRef.current);
        } else if (iceState === 'checking') {
          setStatus('ICE checking...');
        } else if (iceState === 'failed') {
          console.warn('⚠️ ICE connection failed');
          setStatus('ICE failed - Retrying...');
          handleReconnect();
        } else if (iceState === 'disconnected') {
          setStatus('ICE disconnected - Retrying...');
          handleReconnect();
        } else if (iceState === 'closed') {
          setStatus('ICE connection closed');
        }
      };

      // ICE gathering state monitoring
      pc.onicegatheringstatechange = () => {
        const gatheringState = pc.iceGatheringState;
        console.log('🔍 ICE gathering state:', gatheringState);
        
        if (gatheringState === 'gathering') {
          setStatus('Gathering ICE candidates...');
        } else if (gatheringState === 'complete') {
          console.log('✅ ICE gathering complete');
        }
      };

      // ICE candidate events
      pc.onicecandidateerror = (event) => {
        console.error('❌ ICE candidate error:', event);
      };

      return pc;

    } catch (error) {
      console.error('WebRTC error:', error);
      setStatus('WebRTC Error');
      throw error;
    }
  };

  // Initialize Socket
  const initializeSocket = () => {
    return new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        withCredentials: true,
        transports: ['websocket', 'polling']
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('✅ Socket connected');
        
        const userId = getValidUserId();
        const userData = localStorage.getItem('user');
        const userName = userData ? JSON.parse(userData).name : 'User';
        
        socket.emit('register-user', { userId, userName });
        socket.emit('join-room', { roomId, userId, userName });
        
        resolve(socket);
      });

      socket.on('connect_error', (error) => {
        console.error('Socket error:', error);
        setStatus('Connection failed');
        reject(error);
      });

      // Room events
      socket.on('joined-room', (data) => {
        console.log('✅ Joined room:', data);
        setStatus(data.isCaller ? 'Ready to call...' : 'Waiting for call...');
        
        if (data.isCaller) {
          // Caller creates offer after a delay to ensure tracks are ready
          setTimeout(() => createOffer(), 3000);
        }
      });

      socket.on('partner-joined', (data) => {
        console.log('👤 Partner joined:', data);
        setPartnerName(data.userName || 'Partner');
        setStatus('Partner joined - Connecting...');
        
        if (callState.isCaller) {
          setTimeout(() => createOffer(), 2000);
        }
      });

      // WebRTC signaling - FIXED
      socket.on('webrtc-signal', async (data) => {
        console.log('📡 Received signal:', data.type);
        
        if (!pcRef.current) return;

        try {
          if (data.type === 'offer') {
            console.log('📥 Processing offer...');
            setStatus('Connecting...');
            
            // Debug incoming offer SDP
            console.log('📋 Incoming offer SDP contains audio:', data.offer.sdp.includes('m=audio'));
            console.log('📋 Incoming offer SDP contains video:', data.offer.sdp.includes('m=video'));
            
            await pcRef.current.setRemoteDescription(data.offer);
            const answer = await pcRef.current.createAnswer();
            
            // Debug answer SDP
            console.log('📋 Answer SDP contains audio:', answer.sdp.includes('m=audio'));
            console.log('📋 Answer SDP contains video:', answer.sdp.includes('m=video'));
            
            await pcRef.current.setLocalDescription(answer);
            
            socket.emit('webrtc-signal', {
              roomId,
              type: 'answer',
              answer: pcRef.current.localDescription
            });

            // Drain any queued ICE candidates
            if (pendingRemoteCandidatesRef.current.length > 0) {
              for (const c of pendingRemoteCandidatesRef.current) {
                try { await pcRef.current.addIceCandidate(c); } catch (e) { console.error(e); }
              }
              pendingRemoteCandidatesRef.current = [];
            }

          } else if (data.type === 'answer') {
            console.log('📥 Processing answer...');
            
            // Debug incoming answer SDP
            console.log('📋 Incoming answer SDP contains audio:', data.answer.sdp.includes('m=audio'));
            console.log('📋 Incoming answer SDP contains video:', data.answer.sdp.includes('m=video'));
            
            await pcRef.current.setRemoteDescription(data.answer);

            // Drain any queued ICE candidates
            if (pendingRemoteCandidatesRef.current.length > 0) {
              for (const c of pendingRemoteCandidatesRef.current) {
                try { await pcRef.current.addIceCandidate(c); } catch (e) { console.error(e); }
              }
              pendingRemoteCandidatesRef.current = [];
            }
            
          } else if (data.type === 'candidate') {
            // If remote description not set yet, buffer
            if (!pcRef.current.remoteDescription) {
              pendingRemoteCandidatesRef.current.push(data.candidate);
            } else {
              await pcRef.current.addIceCandidate(data.candidate);
            }
          }
        } catch (error) {
          console.error('Signal error:', error);
        }
      });

      // User info
      socket.on('user-info', (data) => {
        console.log('👤 User info:', data);
        if (data.userName && data.userName !== 'User') {
          setPartnerName(data.userName);
        }
      });

      socket.on('offer-requested', () => {
        if (callState.isCaller) {
          createOffer();
        }
      });
    });
  };

  // Create offer
  const createOffer = async () => {
    if (!pcRef.current) return;
    
    try {
      console.log('🎯 Creating offer...');
      setStatus('Starting call...');
      
      // Debug current tracks before creating offer
      const senders = pcRef.current.getSenders();
      console.log('📤 Current senders:', senders.length);
      senders.forEach((sender, index) => {
        const track = sender.track;
        if (track) {
          console.log(`Sender ${index}:`, track.kind, track.label, track.enabled);
        }
      });
      
      const offer = await pcRef.current.createOffer();
      
      // Debug offer SDP for audio/video sections
      console.log('📋 Offer SDP contains audio:', offer.sdp.includes('m=audio'));
      console.log('📋 Offer SDP contains video:', offer.sdp.includes('m=video'));
      
      await pcRef.current.setLocalDescription(offer);
      
      socketRef.current.emit('webrtc-signal', {
        roomId,
        type: 'offer',
        offer: pcRef.current.localDescription
      });
      
      setStatus('Call started - Waiting for answer...');
      
    } catch (error) {
      console.error('Offer error:', error);
      setStatus('Failed to start call');
    }
  };

  // Enhanced reconnection with better retry strategy
  const handleReconnect = () => {
    if (retryCountRef.current < 5) { // Increased max retries
      retryCountRef.current++;
      const delay = Math.min(2000 * Math.pow(1.5, retryCountRef.current - 1), 10000); // Exponential backoff with max 10s
      
      console.log(`🔄 Reconnection attempt ${retryCountRef.current}/5 in ${delay}ms`);
      setStatus(`Reconnecting... (${retryCountRef.current}/5)`);
      
      setTimeout(() => {
        if (callState.isCaller) {
          createOffer();
        } else if (socketRef.current) {
          socketRef.current.emit('request-offer', { roomId });
        }
      }, delay);
    } else {
      console.error('❌ Max reconnection attempts reached');
      setStatus('Connection failed - Max retries reached');
    }
  };

  // Test network connectivity and STUN servers
  const testNetworkConnectivity = async () => {
    try {
      console.log('🌐 Testing network connectivity...');
      setStatus('Testing network...');
      
      // Test basic connectivity
      const testPc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      
      let candidatesFound = 0;
      let gatheringComplete = false;
      
      testPc.onicecandidate = (event) => {
        if (event.candidate) {
          candidatesFound++;
          console.log(`🌐 Found ICE candidate ${candidatesFound}:`, event.candidate.type, event.candidate.protocol);
        }
      };
      
      testPc.onicegatheringstatechange = () => {
        if (testPc.iceGatheringState === 'complete') {
          gatheringComplete = true;
          console.log(`✅ ICE gathering complete. Found ${candidatesFound} candidates`);
          testPc.close();
          
          if (candidatesFound > 0) {
            setStatus('Network test passed - Retrying connection...');
            manualReconnect();
          } else {
            setStatus('Network test failed - No ICE candidates found');
          }
        }
      };
      
      // Create a dummy offer to trigger ICE gathering
      await testPc.createOffer();
      await testPc.setLocalDescription(await testPc.createOffer());
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (!gatheringComplete) {
          console.warn('⚠️ Network test timeout');
          testPc.close();
          setStatus('Network test timeout - Retrying anyway...');
          manualReconnect();
        }
      }, 5000);
      
    } catch (error) {
      console.error('❌ Network test failed:', error);
      setStatus('Network test failed - Retrying anyway...');
      manualReconnect();
    }
  };

  // Manual reconnect
  const manualReconnect = () => {
    retryCountRef.current = 0;
    if (callState.isCaller) {
      createOffer();
    } else if (socketRef.current) {
      socketRef.current.emit('request-offer', { roomId });
      setStatus('Requesting call...');
    }
  };

  // Check audio track states
  const checkAudioStates = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      console.log('🔍 Current audio track states:');
      audioTracks.forEach((track, index) => {
        console.log(`Track ${index}:`, {
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted,
          settings: track.getSettings()
        });
      });
      
      if (pcRef.current) {
        const senders = pcRef.current.getSenders();
        console.log('📤 Current senders:');
        senders.forEach((sender, index) => {
          const track = sender.track;
          if (track && track.kind === 'audio') {
            console.log(`Audio sender ${index}:`, {
              label: track.label,
              enabled: track.enabled,
              readyState: track.readyState,
              muted: track.muted
            });
          }
        });
      }
    }
  };

  // Toggle audio test mode
  const toggleAudioTest = () => {
    setAudioTestMode(!audioTestMode);
    if (!audioTestMode) {
      // Start periodic audio state checking
      const interval = setInterval(() => {
        if (audioTestMode) {
          checkAudioStates();
        } else {
          clearInterval(interval);
        }
      }, 2000);
    }
  };

  // Force reinitialize audio track
  const reinitializeAudio = async () => {
    try {
      console.log('🔄 Reinitializing audio track...');
      
      if (localStreamRef.current) {
        // Stop existing audio tracks
        localStreamRef.current.getAudioTracks().forEach(track => track.stop());
        
        // Get new audio track
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: { ideal: 48000 },
            channelCount: { ideal: 1 }
          }
        });
        
        const newAudioTrack = newStream.getAudioTracks()[0];
        if (newAudioTrack && pcRef.current) {
          // Replace the audio track in the peer connection
          const senders = pcRef.current.getSenders();
          const audioSender = senders.find(sender => sender.track && sender.track.kind === 'audio');
          
          if (audioSender) {
            await audioSender.replaceTrack(newAudioTrack);
            console.log('✅ Audio track replaced successfully');
            
            // Update local stream reference
            localStreamRef.current = new MediaStream([
              ...localStreamRef.current.getVideoTracks(),
              newAudioTrack
            ]);
            
            // Update local video element
            if (localRef.current) {
              localRef.current.srcObject = localStreamRef.current;
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to reinitialize audio:', error);
    }
  };

  // Main useEffect
  useEffect(() => {
    let mounted = true;
    let timerInterval;

    const startCall = async () => {
      try {
        console.log('🚀 Starting video call...');
        
        // Get media stream
        const stream = await initializeMedia();
        if (!mounted) return;

        // Initialize WebRTC first so PC is ready before signaling
        await initializeWebRTC(stream);
        if (!mounted) return;

        // Initialize socket after PC exists to avoid race creating offers
        await initializeSocket();
        if (!mounted) return;

        // Start timer
        const startTime = Date.now();
        timerInterval = setInterval(() => {
          if (mounted) {
            const s = Math.floor((Date.now() - startTime) / 1000);
            const mm = String(Math.floor(s / 60)).padStart(2, '0');
            const ss = String(s % 60).padStart(2, '0');
            setDuration(`${mm}:${ss}`);
          }
        }, 1000);

        // Enhanced connection timeout with progressive delays
        connectionTimeoutRef.current = setTimeout(() => {
          if (mounted && !status.includes('Connected')) {
            console.log('⏰ Connection timeout - attempting reconnect');
            setStatus('Connection timeout - Retrying...');
            manualReconnect();
          }
        }, 15000); // Increased timeout to 15 seconds

      } catch (error) {
        if (mounted) {
          console.error('Call setup failed:', error);
          setStatus('Setup failed');
        }
      }
    };

    startCall();

    return () => {
      mounted = false;
      clearTimeout(connectionTimeoutRef.current);
      clearInterval(timerInterval);
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (pcRef.current) {
        pcRef.current.close();
      }
      
      if (socketRef.current) {
        try {
          const userId = localStorage.getItem('userId') || 'anonymous';
          socketRef.current.emit('leave-room', { roomId, userId });
        } catch (e) {}
        socketRef.current.disconnect();
      }
    };
  }, []);

  // Control functions
  const toggleMute = () => {
    if (localStreamRef.current) {
      const nextMuted = !muted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !nextMuted;
      });
      setMuted(nextMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const nextVideoOff = !videoOff;
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = !nextVideoOff;
      });
      setVideoOff(nextVideoOff);
    }
  };

  const endCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (pcRef.current) pcRef.current.close();
    if (socketRef.current) {
      try {
        const userId = localStorage.getItem('userId') || 'anonymous';
        socketRef.current.emit('leave-room', { roomId, userId });
      } catch (e) {}
      socketRef.current.disconnect();
    }
    navigate('/dashboard');
  };

  return (
    <div className="space-y-4 p-4 max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-gray-800">Video Call</h2>

      <div className="p-4 bg-white rounded-lg shadow border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm">
            <span className="font-medium">Partner:</span> {partnerName}
          </div>
          <div className="text-sm">
            <span className="font-medium">Role:</span> {callState.isCaller ? 'Caller' : 'Answerer'}
          </div>
          <div className="text-sm">
            <span className="font-medium">Status:</span> {status} • {duration}
          </div>
        </div>
        
        {mediaError && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-red-700 text-sm">{mediaError}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-black rounded-lg overflow-hidden shadow-lg">
          <video 
            ref={localRef} 
            autoPlay 
            muted 
            playsInline
            className="w-full h-64 md:h-80 object-cover"
          />
          <div className="bg-gray-800 text-white text-center p-2 text-sm">
            You {muted && '🔇'} {videoOff && '📷❌'}
          </div>
        </div>
        <div className="bg-black rounded-lg overflow-hidden shadow-lg">
          <video 
            ref={remoteRef} 
            autoPlay 
            playsInline
            className="w-full h-64 md:h-80 object-cover bg-gray-900"
          />
          <div className="bg-gray-800 text-white text-center p-2 text-sm">
            {partnerName} {status === 'Connected ✅' && '🔊'}
            {!remoteRef.current?.srcObject && ' (Connecting...)'}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        <button 
          className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
            muted ? 'bg-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`} 
          onClick={toggleMute}
        >
          {muted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
        <button 
          className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
            videoOff ? 'bg-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`} 
          onClick={toggleVideo}
        >
          {videoOff ? '📷 Show Video' : '📷 Hide Video'}
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-yellow-600 text-white hover:bg-yellow-700 flex items-center gap-2" 
          onClick={manualReconnect}
        >
          🔄 Reconnect
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 flex items-center gap-2" 
          onClick={testNetworkConnectivity}
        >
          🌐 Test Network
        </button>
        <button 
          className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
            audioTestMode ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
          }`} 
          onClick={toggleAudioTest}
        >
          {audioTestMode ? '🔍 Stop Audio Test' : '🔍 Audio Test'}
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 flex items-center gap-2" 
          onClick={checkAudioStates}
        >
          📊 Check Audio
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-orange-600 text-white hover:bg-orange-700 flex items-center gap-2" 
          onClick={reinitializeAudio}
        >
          🔄 Fix Audio
        </button>
        <button 
          className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 flex items-center gap-2" 
          onClick={endCall}
        >
          📞 End Call
        </button>
      </div>

      <div className="mt-6 p-4 bg-white rounded-lg shadow border">
        <label className="block text-sm font-medium mb-2 text-gray-700">
          Rate your partner (1-5 stars)
        </label>
        <input 
          type="range" 
          min="1" 
          max="5" 
          value={rating} 
          onChange={e => setRating(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="mt-2 text-center">
          <span className="text-lg font-semibold">{rating}</span>
          <span className="ml-2 text-yellow-500">
            {'⭐'.repeat(rating)}
          </span>
        </div>
        <button 
          className="mt-3 w-full bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium" 
          onClick={endCall}
        >
          ✅ End Call & Rate
        </button>
      </div>
    </div>
  );
}