/**
 * @fileoverview MQTT-based chat
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2023, The CONIX Research Center. All rights reserved.
 * @date 2023
 */

/* global ARENAAUTH, $ */

import 'linkifyjs';
import 'linkifyjs/string';
import { Notify } from 'notiflix/build/notiflix-notify-aio';
import { ARENA_EVENTS, JITSI_EVENTS, EVENT_SOURCES, TOPICS } from '../../constants';
import { Delete } from '../core/message-actions';

const UserType = Object.freeze({
    EXTERNAL: 'external',
    SCREENSHARE: 'screenshare',
    ARENA: 'arena',
});

const notifyTypes = Object.freeze({
    info: Notify.info,
    warning: Notify.warning,
    error: Notify.failure,
    success: Notify.success,
});

Notify.init({
    position: 'center-top',
    width: '440px',
    timeout: 1500,
    showOnlyTheLastOne: false,
    messageMaxLength: 100,
    fontFamily: 'Roboto',
    fontSize: '1em',
    clickToClose: true,
    info: {
        textColor: '#545454',
        notiflixIconColor: '#26c0d3',
        background: '#FFFFFF',
    },
    error: {
        notiflixIconColor: '#FFFFFF',
    },
    warning: {
        notiflixIconColor: '#FFFFFF',
    },
});

/**
 * A class to manage an instance of the ARENA chat MQTT and GUI message system.
 */
AFRAME.registerSystem('arena-chat-ui', {
    schema: {
        enabled: { type: 'boolean', default: true },
    },

    async init() {
        const { data } = this;

        if (!data.enabled) return;

        this.upsertLiveUser = this.upsertLiveUser.bind(this);

        ARENA.events.addMultiEventListener(
            [ARENA_EVENTS.ARENA_LOADED, ARENA_EVENTS.MQTT_SUBSCRIBED, ARENA_EVENTS.JITSI_LOADED],
            this.ready.bind(this)
        );
    },
    async ready() {
        const { el } = this;

        const { sceneEl } = el;

        this.arena = sceneEl.systems['arena-scene'];
        this.mqtt = sceneEl.systems['arena-mqtt'];
        this.mqttc = ARENA.Mqtt.MQTTWorker;
        this.jitsi = sceneEl.systems['arena-jitsi'];
        this.health = sceneEl.systems['arena-health-ui'];

        this.isSpeaker = false;
        this.stats = {};
        this.status = {};

        // users list
        this.liveUsers = {};

        this.userId = this.arena.idTag;
        this.realm = ARENA.defaults.realm;
        this.displayName = ARENA.getDisplayName();
        this.nameSpace = this.arena.nameSpace;
        this.scene = this.arena.sceneName;
        this.devInstance = ARENA.defaults.devInstance;
        this.isSceneWriter = this.arena.isUserSceneWriter();

        const topicVars = {
            nameSpace: this.nameSpace,
            sceneName: this.scene,
            idTag: this.userId,
        };
        this.publicChatTopic = TOPICS.PUBLISH.SCENE_CHAT.formatStr(topicVars);
        // send private messages to a user (publish only), template partially
        this.privateChatTopic = TOPICS.PUBLISH.SCENE_CHAT_PRIVATE.formatStr(topicVars);
        this.publicPresenceTopic = TOPICS.PUBLISH.SCENE_PRESENCE.formatStr(topicVars);
        // send private presence update to a user (publish only), template partially
        this.privatePresenceTopic = TOPICS.PUBLISH.SCENE_PRESENCE_PRIVATE.formatStr(topicVars);

        // Announce ASAP
        this.presenceMsg({ action: 'join', type: UserType.ARENA });

        this.keepalive_interval_ms = 30000;
        // cleanup userlist periodically
        window.setInterval(this.userCleanup.bind(this), this.keepalive_interval_ms * 3);

        /*
        // TODO (mwfarb): update to new scene-scoped chat topic-v5 structure
        Clients listen for chat messages on:
            - global public (*o*pen) topic (<realm>/c/<scene-namespace>/o/#)
            - a user (*p*rivate) topic (<realm>/c/<scene-namespace>/p/userhandle/#)

        Clients write always to a topic with its own userhandle:
              - a topic for each user for private messages ( <realm>/c/<scene-namespace>/p/[other-userid]/userhandle)
            - a global topic (ugtopic; r<realm>/c/<scene-namespace>/o/userhandle);

        where userhandle = userid + btoa(userid)

        Note: topic must always end with userhandle and match from_un in the message (check on client at receive, and/or on publish at pubsub server)
        Note: scene-only messages are sent to public topic and filtered at the client
        Note: scene-namespace is the current scene namespace

        Summary of topics/permissions:
            <realm>/c/<scene-namespace>/p/<userid>/#  - receive private messages
            <realm>/c/<scene-namespace>/o/#  - receive open messages to everyone and/or scene
            <realm>/c/<scene-namespace>/o/userhandle - send open messages (chat keepalive, messages to all/scene)
            <realm>/c/<scene-namespace>/p/[regex-matching-any-userid]/userhandle - private messages to user
        */

        // counter for unread msgs
        this.unreadMsgs = 0;

        // create chat html elements
        const btnGroup = document.getElementById('chat-button-group');
        btnGroup.parentElement.classList.remove('d-none');

        this.chatBtn = document.createElement('div');
        this.chatBtn.className = 'arena-button chat-button';
        this.chatBtn.setAttribute('title', 'Chat');
        this.chatBtn.style.backgroundImage = "url('src/systems/ui/images/message.png')";
        btnGroup.appendChild(this.chatBtn);

        this.chatDot = document.createElement('span');
        this.chatDot.className = 'dot';
        this.chatDot.innerText = '...';
        this.chatBtn.appendChild(this.chatDot);

        // TODO (mwfarb): make more granular by rendering when incoming message arrives
        // use token permissions to render message ui
        this.chatBtn.style.display = this.arena.isUserChatWriter() ? 'block' : 'none';

        this.usersBtn = document.createElement('div');
        this.usersBtn.className = 'arena-button users-button';
        this.usersBtn.setAttribute('title', 'User List');
        this.usersBtn.style.backgroundImage = "url('src/systems/ui/images/users.png')";
        btnGroup.appendChild(this.usersBtn);

        this.usersDot = document.createElement('span');
        this.usersDot.className = 'dot';
        this.usersDot.innerText = '1';
        this.usersBtn.appendChild(this.usersDot);

        this.lmBtn = document.createElement('div');
        this.lmBtn.className = 'arena-button landmarks-button';
        this.lmBtn.setAttribute('title', 'Landmarks');
        this.lmBtn.style.backgroundImage = "url('src/systems/ui/images/landmarks.png')";
        btnGroup.appendChild(this.lmBtn);
        this.lmBtn.style.display = 'none';

        // chat
        this.chatPopup = document.createElement('div');
        this.chatPopup.className = 'chat-popup';
        this.chatPopup.style.display = 'none';
        document.body.appendChild(this.chatPopup);

        this.closeChatBtn = document.createElement('span');
        this.closeChatBtn.className = 'close';
        this.closeChatBtn.innerText = '×';
        this.chatPopup.appendChild(this.closeChatBtn);

        this.msgList = document.createElement('div');
        this.msgList.className = 'message-list';
        this.chatPopup.appendChild(this.msgList);

        const formDiv = document.createElement('div');
        formDiv.className = 'form-container';
        this.chatPopup.appendChild(formDiv);

        this.msgTxt = document.createElement('textarea');
        this.msgTxt.setAttribute('rows', '1');
        this.msgTxt.setAttribute('placeholder', 'Type message..');
        formDiv.className = 'form-container';
        formDiv.appendChild(this.msgTxt);

        this.toSel = document.createElement('select');
        this.toSel.className = 'sel';
        formDiv.appendChild(this.toSel);

        this.addToSelOptions();

        this.msgBtn = document.createElement('button');
        this.msgBtn.className = 'btn';
        formDiv.appendChild(this.msgBtn);

        // users
        this.usersPopup = document.createElement('div');
        this.usersPopup.className = 'users-popup';
        this.usersPopup.style.display = 'none';
        document.body.appendChild(this.usersPopup);

        this.closeUsersBtn = document.createElement('span');
        this.closeUsersBtn.className = 'close';
        this.closeUsersBtn.innerText = '×';
        this.usersPopup.appendChild(this.closeUsersBtn);

        if (this.isSceneWriter) {
            const muteAllDiv = document.createElement('div');
            muteAllDiv.className = 'mute-all';
            this.usersPopup.appendChild(muteAllDiv);

            this.silenceAllBtn = document.createElement('span');
            this.silenceAllBtn.className = 'users-list-btn ma';
            this.silenceAllBtn.title = 'Silence (Mute Everyone)';
            muteAllDiv.appendChild(this.silenceAllBtn);
        }

        let label = document.createElement('span');
        label.innerHTML = '<br/>&nbsp';
        label.style.fontSize = 'small';
        this.usersPopup.appendChild(label);

        this.nSceneUserslabel = document.createElement('span');
        this.nSceneUserslabel.style.fontSize = 'small';
        this.usersPopup.appendChild(this.nSceneUserslabel);

        label = document.createElement('span');
        label.innerText = ' Users (you can find and mute users):';
        label.style.fontSize = 'small';
        this.usersPopup.appendChild(label);

        const userDiv = document.createElement('div');
        userDiv.className = 'user-list';
        this.usersPopup.appendChild(userDiv);

        this.usersList = document.createElement('ul');
        userDiv.appendChild(this.usersList);

        // landmarks
        this.lmPopup = document.createElement('div');
        this.lmPopup.className = 'users-popup';
        this.lmPopup.style.display = 'none';
        document.body.appendChild(this.lmPopup);

        this.closeLmBtn = document.createElement('span');
        this.closeLmBtn.className = 'close';
        this.closeLmBtn.innerHTML = '&times';
        this.lmPopup.appendChild(this.closeLmBtn);

        label = document.createElement('span');
        label.innerHTML = '<br/>&nbspLandmarks (buttons allow to find landmarks):';
        label.style.fontSize = 'small';
        this.lmPopup.appendChild(label);

        const lmDiv = document.createElement('div');
        lmDiv.className = 'user-list';
        this.lmPopup.appendChild(lmDiv);

        this.lmList = document.createElement('ul');
        lmDiv.appendChild(this.lmList);

        const _this = this;

        this.displayAlert('Not sending audio or video. Use icons on the right to start.', 5000);

        let expanded = false;
        const expandBtn = document.getElementById('chat-button-group-expand-icon');
        document.querySelector('.chat-button-group-expand').addEventListener('click', () => {
            expanded = !expanded;
            if (expanded) {
                // toggled
                expandBtn.classList.replace('fa-angle-left', 'fa-angle-right');
                btnGroup.classList.add('d-none');
            } else {
                expandBtn.classList.replace('fa-angle-right', 'fa-angle-left');
                btnGroup.classList.remove('d-none');
            }
        });

        this.chatBtn.onclick = function onChatClick() {
            if (_this.chatPopup.style.display === 'none') {
                _this.chatPopup.style.display = 'block';
                _this.usersPopup.style.display = 'none';
                _this.chatDot.style.display = 'none';
                _this.lmPopup.style.display = 'none';
                _this.unreadMsgs = 0;

                // scroll to bottom
                _this.msgList.scrollTop = _this.msgList.scrollHeight;

                // focus on textbox
                _this.msgTxt.focus();
            } else {
                _this.chatPopup.style.display = 'none';
            }
        };

        this.usersBtn.onclick = function onUsersClick() {
            if (_this.usersPopup.style.display === 'none') {
                _this.chatPopup.style.display = 'none';
                _this.usersPopup.style.display = 'block';
                _this.lmPopup.style.display = 'none';
                _this.populateUserList();
            } else {
                _this.usersPopup.style.display = 'none';
            }
        };

        this.closeChatBtn.onclick = function onCloseChatClick() {
            _this.chatPopup.style.display = 'none';
        };

        this.closeUsersBtn.onclick = function onCloseUsersClick() {
            _this.usersPopup.style.display = 'none';
        };

        this.msgBtn.onclick = function onMsgClick() {
            if (_this.msgTxt.value.length > 0) _this.sendMsg(_this.msgTxt.value);
            _this.msgTxt.value = '';
        };

        this.lmBtn.onclick = function onLandmarkClick() {
            if (_this.lmPopup.style.display === 'none') {
                _this.chatPopup.style.display = 'none';
                _this.usersPopup.style.display = 'none';
                _this.lmPopup.style.display = 'block';
            } else {
                _this.lmPopup.style.display = 'none';
            }
        };

        this.closeLmBtn.onclick = function onCloseLandmarkClick() {
            _this.lmPopup.style.display = 'none';
        };

        this.msgTxt.addEventListener('keyup', (event) => {
            event.preventDefault();
            if (event.key === 'Enter') {
                if (_this.msgTxt.value.length > 1) _this.sendMsg(_this.msgTxt.value);
                _this.msgTxt.value = '';
            }
        });

        // send sound on/off msg to all
        if (this.silenceAllBtn) {
            this.silenceAllBtn.onclick = function onSilenceAllClick() {
                Swal.fire({
                    title: 'Are you sure?',
                    text: 'This will send a mute request to all users.',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes',
                    reverseButtons: true,
                }).then((result) => {
                    if (result.isConfirmed) {
                        // send to all scene topic
                        _this.ctrlMsg('public', 'sound:off');
                    }
                });
            };
        }

        // check if we jumped to a different scene from a "teleport"
        const moveToCamera = localStorage.getItem('moveToFrontOfCamera');
        if (moveToCamera !== null) {
            localStorage.removeItem('moveToFrontOfCamera');
            this.moveToFrontOfCamera(moveToCamera);
        }

        this.onNewSettings = this.onNewSettings.bind(this);
        this.onUserJitsiJoin = this.onUserJitsiJoin.bind(this);
        this.onScreenshare = this.onScreenshare.bind(this);
        this.onUserJitsiLeft = this.onUserJitsiLeft.bind(this);
        this.onDominantSpeakerChanged = this.onDominantSpeakerChanged.bind(this);
        this.onTalkWhileMuted = this.onTalkWhileMuted.bind(this);
        this.onNoisyMic = this.onNoisyMic.bind(this);
        this.onConferenceError = this.onConferenceError.bind(this);
        this.onJitsiStatsLocal = this.onJitsiStatsLocal.bind(this);
        this.onJitsiStatsRemote = this.onJitsiStatsRemote.bind(this);
        this.onJitsiStatus = this.onJitsiStatus.bind(this);

        ARENA.events.addEventListener(JITSI_EVENTS.CONNECTED, this.onJitsiConnect.bind(this));
        sceneEl.addEventListener(ARENA_EVENTS.NEW_SETTINGS, this.onNewSettings);
        sceneEl.addEventListener(JITSI_EVENTS.USER_JOINED, this.onUserJitsiJoin);
        sceneEl.addEventListener(JITSI_EVENTS.SCREENSHARE, this.onScreenshare);
        sceneEl.addEventListener(JITSI_EVENTS.USER_LEFT, this.onUserJitsiLeft);
        sceneEl.addEventListener(JITSI_EVENTS.DOMINANT_SPEAKER_CHANGED, this.onDominantSpeakerChanged);
        sceneEl.addEventListener(JITSI_EVENTS.TALK_WHILE_MUTED, this.onTalkWhileMuted);
        sceneEl.addEventListener(JITSI_EVENTS.NOISY_MIC, this.onNoisyMic);
        sceneEl.addEventListener(JITSI_EVENTS.CONFERENCE_ERROR, this.onConferenceError);
        sceneEl.addEventListener(JITSI_EVENTS.STATS_LOCAL, this.onJitsiStatsLocal);
        sceneEl.addEventListener(JITSI_EVENTS.STATS_REMOTE, this.onJitsiStatsRemote);
        sceneEl.addEventListener(JITSI_EVENTS.STATUS, this.onJitsiStatus);
    },

    onNewSettings(e) {
        const args = e.detail;
        if (!args.userName) return; // only handle a user name change
        this.displayName = args.userName;
        this.presenceMsg({ action: 'update' });
        this.populateUserList();
    },

    /**
     * Upserts a user in the liveUsers dictionary. Updates timestamp tag either way
     * @param {string} id - User ID, typically idTag
     * @param {object} user - User object
     * @param {?boolean} merge - If true, merge user object with existing user
     * @param {?boolean} skipUserlist - If true, do not update user list
     * @return {boolean} - True if user is a new addition
     */
    upsertLiveUser(id, user, merge = false, skipUserlist = false) {
        let newUser = false;
        if (!this.liveUsers[id]) newUser = true;

        if (!this.liveUsers[id] || merge === false) {
            this.liveUsers[id] = user;
        } else {
            this.liveUsers[id] = { ...this.liveUsers[id], ...user };
        }
        this.liveUsers[id].ts = new Date().getTime();
        if (newUser && !skipUserlist) this.populateUserList(this.liveUsers[id]);
        return newUser;
    },

    /**
     * Called when we connect to a jitsi conference (including reconnects)
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onJitsiConnect(e) {
        const args = e.detail;
        args.pl.forEach((user) => {
            // console.log('Jitsi User: ', user);
            // check if jitsi knows about someone we don't; add to user list
            const userObj = {
                jid: user.jid,
                dn: user.dn,
                type: this.liveUsers[user.id] ? UserType.ARENA : UserType.EXTERNAL,
            };
            this.upsertLiveUser(user.id, userObj, true, true);
        });
        this.populateUserList();
    },

    /**
     * Called when user joins
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onUserJitsiJoin(e) {
        if (e.detail.src === EVENT_SOURCES.CHAT) return; // ignore our events
        const user = e.detail;
        this.upsertLiveUser(user.id, {
            jid: user.jid,
            dn: user.dn,
            type: this.liveUsers[user.id] ? UserType.ARENA : UserType.EXTERNAL,
        });
    },

    /**
     * Called when a user screenshares
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onScreenshare(e) {
        if (e.detail.src === EVENT_SOURCES.CHAT) return; // ignore our events
        const user = e.detail;
        const newUser = this.upsertLiveUser(user.id, {
            jid: user.jid,
            dn: user.dn,
            sid: user.sn,
            type: UserType.SCREENSHARE, // indicate we know the user is screensharing
        });
        if (!newUser) this.populateUserList();
    },

    /**
     * Called when user leaves
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onUserJitsiLeft(e) {
        if (e.detail.src === EVENT_SOURCES.CHAT) return; // ignore our events
        const user = e.detail;
        delete this.liveUsers[user.id];
        this.populateUserList();
    },

    /**
     * Called when dominant speaker changes.
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onDominantSpeakerChanged(e) {
        const user = e.detail;

        // if speaker exists, show speaker graph in user list
        const speakerId = user.id ? user.id : this.userId; // or self is speaker
        if (this.liveUsers[speakerId]) {
            this.liveUsers[speakerId].speaker = true;
        }
        // if previous speaker exists, show speaker graph in user list
        if (this.liveUsers[user.pid]) {
            this.liveUsers[user.pid].speaker = false;
        }
        this.isSpeaker = speakerId === this.userId;
        this.populateUserList();
    },

    /**
     * Called when user is talking on mute.
     */
    onTalkWhileMuted() {
        this.displayAlert(`You are talking on mute.`, 2000, 'warning');
    },

    /**
     * Called when user's microphone is very noisy.
     */
    onNoisyMic() {
        this.displayAlert(`Your microphone appears to be noisy.`, 2000, 'warning');
    },

    onConferenceError(e) {
        // display error to user
        const { errorCode } = e.detail;
        const err = this.health.getErrorDetails(errorCode);
        this.displayAlert(err.title, 5000, 'error');
    },

    /**
     * Called when Jitsi local stats are updated.
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onJitsiStatsLocal(e) {
        const { jid } = e.detail;
        const { stats } = e.detail;
        // local
        if (!this.stats) this.stats = {};
        this.stats.conn = stats;
        this.stats.resolution = stats.resolution[jid];
        this.stats.framerate = stats.framerate[jid];
        this.stats.codec = stats.codec[jid];
        // local and remote
        const _this = this;
        Object.keys(this.liveUsers).forEach((arenaId) => {
            if (!_this.liveUsers[arenaId].stats) _this.liveUsers[arenaId].stats = {};
            const { jid: _jid } = _this.liveUsers[arenaId];
            _this.liveUsers[arenaId].stats.resolution = stats.resolution[_jid];
            _this.liveUsers[arenaId].stats.framerate = stats.framerate[_jid];
            _this.liveUsers[arenaId].stats.codec = stats.codec[_jid];
        });
        this.populateUserList();
    },

    /**
     * Called when Jitsi remote stats are updated.
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onJitsiStatsRemote(e) {
        const { jid } = e.detail;
        const arenaId = e.detail.id ? e.detail.id : e.detail.jid;
        const { stats } = e.detail;
        // remote
        if (this.liveUsers[arenaId]) {
            if (!this.liveUsers[arenaId].stats) this.liveUsers[arenaId].stats = {};
            this.liveUsers[arenaId].stats.conn = stats;
            this.liveUsers[arenaId].jid = jid;
            this.liveUsers[arenaId].ts = new Date().getTime();
            this.populateUserList();
            // update arena-user connection quality
            if (stats && stats.connectionQuality) {
                const userCamId = `camera_${arenaId}`;
                const userCamEl = document.querySelector(`[id='${userCamId}']`);
                if (userCamEl) {
                    userCamEl.setAttribute('arena-user', 'jitsiQuality', stats.connectionQuality);
                }
            }
        }
    },

    /**
     * Called when Jitsi remote and local status object is updated.
     * @param {Object} e event object; e.detail contains the callback arguments
     */
    onJitsiStatus(e) {
        const arenaId = e.detail.id;
        const { status } = e.detail;
        // local
        if (this.userId === arenaId) {
            this.status = status;
        }
        // remote
        if (this.liveUsers[arenaId]) {
            this.liveUsers[arenaId].status = status;
            this.liveUsers[arenaId].ts = new Date().getTime();
        }
        this.populateUserList();
    },

    /**
     * Getter to return the active user list state.
     * @return {[Object]} The list of active users.
     */
    getUserList() {
        return this.liveUsers;
    },

    /**
     * Utility to know if the user has been authenticated.
     * @param {string} idTag The user idTag.
     * @return {boolean} True if non-anonymous.
     */
    isUserAuthenticated(idTag) {
        return !idTag.includes('anonymous');
    },

    isModerator(status) {
        return status && status.role === 'moderator';
    },

    /**
     * Method to publish outgoing chat messages, gathers destination from UI.
     * @param {*} msgTxt The message text.
     */
    sendMsg(msgTxt) {
        const now = new Date();
        const toUid = this.toSel.value;
        const msg = {
            object_id: this.userId,
            type: 'chat',
            dn: this.displayName,
            text: msgTxt,
        };
        const dstTopic =
            this.toSel.value === 'public' ? this.publicChatTopic : this.privateChatTopic.formatStr({ toUid });
        // console.log('sending', msg, 'to', dstTopic);
        try {
            this.mqttc.publish(dstTopic, msg);
        } catch (err) {
            console.error('chat msg send failed:', err.message);
        }
        const fromDesc = `${decodeURI(this.displayName)} (${this.toSel.options[this.toSel.selectedIndex].text})`;
        this.txtAddMsg(msg.text, `${fromDesc} ${now.toLocaleTimeString()}`, 'self');
    },

    /**
     * Handles incoming presence topic messages
     * @param {object} msg - The message object
     * @param {?string} topicToUid - The target uuid from the topic, if set
     */
    onPresenceMessageArrived(msg, topicToUid) {
        switch (msg.action) {
            case 'join':
                if (!topicToUid) {
                    // This is a public join, respond privately to user
                    this.presenceMsg({ action: 'join', type: UserType.ARENA }, msg.object_id);
                }
            // NO break, fallthrough to update
            case 'update':
                this.upsertLiveUser(msg.object_id, { dn: msg.dn, type: msg.type }, true);
                break;
            case 'leave':
                // Explicity remove user object from the scene, as this new lastWill
                Delete.handle({ id: msg.object_id });
                delete this.liveUsers[msg.object_id];
                this.populateUserList();
                break;
            default:
                console.log('Unknown presence action:', msg.action);
        }
    },

    /**
     * Handler for incoming subscription chat messages.
     * @param {Object} msg - The message object.
     * @param {?string} topicToUid - The target uuid from the topic
     */
    onChatMessageArrived(msg, topicToUid) {
        const { el } = this;
        const { sceneEl } = el;

        // ignore invalid and our own messages
        if (msg.object_id === this.userId) return;

        this.upsertLiveUser(msg.object_id, { dn: msg.dn, type: UserType.ARENA }, true);

        // process commands
        if (msg.type === 'chat-ctrl') {
            if (msg.text === 'sound:off') {
                // console.log('muteAudio', this.jitsi.hasAudio);
                // only mute
                if (this.jitsi.hasAudio) {
                    const sideMenu = sceneEl.systems['arena-side-menu-ui'];
                    sideMenu.clickButton(sideMenu.buttons.AUDIO);
                }
            } else if (msg.text === 'logout') {
                const warn = `You have been asked to leave in 5 seconds by ${msg.dn}.`;
                this.displayAlert(warn, 5000, 'warning');
                setTimeout(() => {
                    ARENAAUTH.signOut();
                }, 5000);
            }
            return;
        }

        // only proceed for chat messages
        if (msg.type !== 'chat') return;

        // Determine msg to based on presence of topic TO_UID token
        const fromDesc = `${decodeURI(msg.dn)} (${topicToUid === this.userId ? 'private to me' : 'public'})`;

        this.txtAddMsg(msg.text, `${fromDesc} ${new Date(msg.timestamp).toLocaleTimeString()}`, 'other');

        this.unreadMsgs++;
        this.chatDot.textContent = this.unreadMsgs < 100 ? this.unreadMsgs : '...';

        // check if chat is visible
        if (this.chatPopup.style.display === 'none') {
            const msgText = msg.text.length > 15 ? `${msg.text.substring(0, 15)}...` : msg.text;
            this.displayAlert(`New message from ${msg.dn}: ${msgText}.`, 3000);
            this.chatDot.style.display = 'block';
        }
    },

    /**
     * Adds a text message to the text message panel.
     * @param {string} msg The message text.
     * @param {string} status The 'from' display username.
     * @param {string} who Sender scope: self, other.
     */
    txtAddMsg(msg, status, who) {
        let whoClass;
        if (who !== 'self' && who !== 'other') {
            whoClass = 'other';
        } else {
            whoClass = who;
        }
        const statusSpan = document.createElement('span');
        statusSpan.className = `status ${whoClass}`; // "self" | "other"
        statusSpan.textContent = status;
        this.msgList.appendChild(statusSpan);

        const msgSpan = document.createElement('span');
        msgSpan.className = `msg ${whoClass}`; // "self" | "other"
        const host = `https://${window.location.host.replace(/\./g, '\\.')}`;
        const pattern = `${host}/[a-zA-Z0-9]*/[a-zA-Z0-9]*(.*)*`; // permissive regex for a scene
        const regex = new RegExp(pattern);

        let displayMsg;
        if (msg.match(regex) != null) {
            // no new tab if we have a link to an arena scene
            displayMsg = msg.linkify({
                target: '_parent',
            });
        } else {
            displayMsg = msg.linkify({
                target: '_blank',
            });
        }
        msgSpan.innerHTML = displayMsg;
        this.msgList.appendChild(msgSpan);

        // scroll to bottom
        this.msgList.scrollTop = this.msgList.scrollHeight;
    },

    /**
     * Draw the contents of the Chat user list panel given its current state.
     * Adds a newUser if requested.
     * @param {Object} newUser The new user object to add.
     */
    populateUserList(newUser = undefined) {
        const { el } = this;

        const { sceneEl } = el;

        this.usersList.textContent = '';
        const selVal = this.toSel.value;
        if (newUser) {
            // only update 'to' select for new users
            this.toSel.textContent = '';
            this.addToSelOptions();
        }

        const _this = this;
        const userList = [];
        let nSceneUsers = 1;
        Object.keys(this.liveUsers).forEach((key) => {
            nSceneUsers++; // count all users
            userList.push({
                uid: key,
                dn: _this.liveUsers[key].dn,
                sid: _this.liveUsers[key].sid,
                type: _this.liveUsers[key].type,
                speaker: _this.liveUsers[key].speaker,
                stats: _this.liveUsers[key].stats,
                status: _this.liveUsers[key].status,
            });
        });

        userList.sort((a, b) => a.dn.localeCompare(b.dn));

        this.nSceneUserslabel.textContent = nSceneUsers;
        this.usersDot.textContent = nSceneUsers < 100 ? nSceneUsers : '...';
        if (newUser) {
            let msg = '';
            if (newUser.type !== UserType.SCREENSHARE) {
                msg = `${newUser.dn}${newUser.type === UserType.EXTERNAL ? ' (external)' : ''} joined.`;
            } else {
                msg = `${newUser.dn} started screen sharing.`;
            }
            let alertType = 'info';
            if (newUser.type !== 'arena') alertType = 'warning';
            this.displayAlert(msg, 5000, alertType, true);
        }

        const meUli = document.createElement('li');
        meUli.textContent = `${this.displayName} (Me)`;
        if (this.isSpeaker) {
            meUli.style.color = 'green';
        }
        _this.usersList.appendChild(meUli);
        this.addJitsiStats(meUli, this.stats, this.status, meUli.textContent);
        const myUBtnCtnr = document.createElement('div');
        myUBtnCtnr.className = 'users-list-btn-ctnr';
        meUli.appendChild(myUBtnCtnr);

        const usspan = document.createElement('span');
        usspan.className = 'users-list-btn s';
        usspan.title = 'Mute Myself';
        myUBtnCtnr.appendChild(usspan);
        // span click event (sound off)
        usspan.onclick = () => {
            // only mute
            if (this.jitsi.hasAudio) {
                const sideMenu = sceneEl.systems['arena-side-menu-ui'];
                sideMenu.clickButton(sideMenu.buttons.AUDIO);
            }
        };

        // list users
        userList.forEach((user) => {
            const uli = document.createElement('li');
            const name = user.type !== UserType.SCREENSHARE ? user.dn : `${user.dn}'s Screen Share`;
            if (user.speaker) {
                uli.style.color = 'green';
            }
            uli.textContent = `${decodeURI(name)}${user.type === UserType.EXTERNAL ? ' (external)' : ''}`;
            const uBtnCtnr = document.createElement('div');
            uBtnCtnr.className = 'users-list-btn-ctnr';
            uli.appendChild(uBtnCtnr);

            const fuspan = document.createElement('span');
            fuspan.className = 'users-list-btn fu';
            fuspan.title = 'Find User';
            uBtnCtnr.appendChild(fuspan);

            // span click event (move us to be in front of another clicked user)
            const { uid, scene, sid } = user;
            fuspan.onclick = function findUserClick() {
                _this.moveToFrontOfCamera(sid ?? uid, scene);
            };

            if (user.type !== UserType.SCREENSHARE) {
                const sspan = document.createElement('span');
                sspan.className = 'users-list-btn s';
                sspan.title = 'Mute User';
                uBtnCtnr.appendChild(sspan);

                // span click event (send sound on/off msg to ussr)
                sspan.onclick = function muteUserClick() {
                    // message to target user
                    _this.ctrlMsg(user.uid, 'sound:off');
                };

                // Remove user to be rendered for all users, allowing full moderation for all.
                // This follows Jitsi's philosophy that everyone should have the power to kick
                // out inappropriate participants: https://jitsi.org/security/.
                const kospan = document.createElement('span');
                kospan.className = 'users-list-btn ko';
                kospan.title = 'Remove User';
                uBtnCtnr.appendChild(kospan);
                kospan.onclick = function kickUserClick() {
                    Swal.fire({
                        title: 'Are you sure?',
                        text: `This will send an automatic logout request to ${decodeURI(user.dn)}.`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: 'Yes',
                        reverseButtons: true,
                    }).then((result) => {
                        if (result.isConfirmed) {
                            _this.displayAlert(`Notifying ${decodeURI(user.dn)} of removal.`, 5000);
                            _this.ctrlMsg(user.uid, 'logout');
                            // kick jitsi channel directly as well
                            const warn = `You have been asked to leave by ${_this.displayName}.`;
                            _this.jitsi.kickout(user.uid, warn);
                        }
                    });
                };

                if (user.type === UserType.EXTERNAL) uli.className = 'external';

                if (newUser) {
                    // only update 'to' select for new users
                    const op = document.createElement('option');
                    op.value = user.uid;
                    op.textContent = `to: ${decodeURI(user.dn)}`;
                    _this.toSel.appendChild(op);
                }
            }
            _this.usersList.appendChild(uli);
            this.addJitsiStats(uli, user.stats, user.status, uli.textContent);
        });
        this.toSel.value = selVal; // preserve selected value
    },

    /**
     * Apply a jitsi signal icon after the user name in list item 'uli'.
     * @param {Element} uli List item with only name, not buttons yet.
     * @param {Object} stats The jisti video stats object if any
     * @param {Object} status The jitsi status object if any
     * @param {string} name The display name of the user
     */
    addJitsiStats(uli, stats, status, name) {
        if (!stats) return;
        const iconStats = document.createElement('i');
        iconStats.className = 'videoStats fa fa-signal';
        iconStats.style.color = stats.conn ? this.jitsi.getConnectionColor(stats.conn.connectionQuality) : 'gray';
        iconStats.style.paddingLeft = '5px';
        uli.appendChild(iconStats);
        const spanStats = document.createElement('span');
        uli.appendChild(spanStats);
        // show current stats on hover/mouseover
        const _this = this;
        iconStats.onmouseover = function statsMouseOver() {
            spanStats.textContent = stats ? _this.jitsi.getConnectionText(name, stats, status) : 'None';
            const userList = $('.user-list');
            const offsetUl = userList.offset();
            const midpointW = offsetUl.left + userList.width() / 2;
            const midpointH = offsetUl.top + userList.height() / 2;
            const offsetSig = $(this).offset();
            const offLeft = offsetSig.left < midpointW ? offsetSig.left : 0;
            const offTop = offsetSig.top < midpointH ? 10 : offsetUl.top - offsetSig.top;
            $(this).next('span').fadeIn(200).addClass('videoTextTooltip');
            $(this).next('span').css('left', `${offLeft}px`);
            $(this).next('span').css('top', `${offTop}px`);
        };
        iconStats.onmouseleave = function statsMouseLeave() {
            $(this).next('span').fadeOut(200);
        };

        // show moderator info
        if (this.isModerator(status)) {
            const iconModerator = document.createElement('i');
            iconModerator.className = 'fa fa-crown';
            iconModerator.style.color = 'black';
            iconModerator.style.paddingLeft = '5px';
            iconModerator.title = 'Moderator';
            uli.appendChild(iconModerator);
        }
    },

    /**
     * Add a landmark to the landmarks list.
     * @param {Object} lm The landmark object.
     */
    addLandmark(lm) {
        const uli = document.createElement('li');
        uli.id = `lmList_${lm.el.id}`;
        uli.textContent = lm.data.label.length > 45 ? `${lm.data.label.substring(0, 45)}...` : lm.data.label;

        const lmBtnCtnr = document.createElement('div');
        lmBtnCtnr.className = 'lm-list-btn-ctnr';
        uli.appendChild(lmBtnCtnr);

        const lspan = document.createElement('span');
        lspan.className = 'lm-list-btn l';
        lspan.title = 'Move to Landmark';
        lmBtnCtnr.appendChild(lspan);

        // setup click event
        lspan.onclick = function onTeleportClick() {
            lm.teleportTo();
        };
        this.lmList.appendChild(uli);
        this.lmBtn.style.display = 'block';
    },

    /**
     * Remove a landmark from the landmarks list.
     * @param {Object} lm The landmark object.
     */
    removeLandmark(lm) {
        document.getElementById(`lmList_${lm.el.id}`).remove();
        if (this.lmList.childElementCount === 0) {
            this.lmBtn.style.display = 'none'; // hide landmarks button
        }
    },

    /**
     * Adds UI elements to select dropdown message destination.
     */
    addToSelOptions() {
        const op = document.createElement('option');
        op.value = 'public';
        op.textContent = `to: everyone`;
        this.toSel.appendChild(op);
    },

    /**
     * Send a presence message to respective topic, either publicly or privately to a single user
     * @param {?object} msg - presence message to merge with default fields
     * @param {?string} to - user id to send the message to privately, otherwise public
     */
    presenceMsg(msg = {}, to = undefined) {
        const dstTopic = to ? this.privatePresenceTopic.formatStr({ toUid: to }) : this.publicPresenceTopic;
        this.mqttc.publish(dstTopic, {
            object_id: this.userId,
            dn: this.displayName,
            ...msg,
        });
    },

    /**
     * Send a chat system control message for other users. Uses chat system topic structure
     * to send a private message.
     * @param {string} to Destination: all, scene, or the user id
     * @param {string} text Body of the message/command.
     */
    ctrlMsg(to, text) {
        let dstTopic;
        if (to === 'public') {
            dstTopic = this.publicChatTopic; // public messages
        } else {
            // replace '{to_uid}' for the 'to' value
            dstTopic = this.privateChatTopic.formatStr({ toUid: to });
        }
        const msg = {
            object_id: this.userId,
            type: 'chat-ctrl',
            text,
        };
        // console.info('ctrl', msg, 'to', dstTopic);
        try {
            this.mqttc.publish(dstTopic, msg);
        } catch (err) {
            console.error('chat-ctrl send failed:', err.message);
        }
    },

    /**
     * Removes orphaned Jitsi users from visible user list.
     * Is called periodically = keepalive_interval_ms * 3.
     */
    userCleanup() {
        const now = new Date().getTime();
        const _this = this;
        Object.keys(_this.liveUsers).forEach((key) => {
            if (
                now - _this.liveUsers[key].ts > _this.keepalive_interval_ms &&
                _this.liveUsers[key].type === UserType.ARENA
            ) {
                delete _this.liveUsers[key];
            }
        });
    },

    /**
     * Uses Notiflix library to popup a toast message.
     * @param {string} msg Text of the message.
     * @param {number} timeMs Duration of message in milliseconds.
     * @param {string} type Style of message: success, error, warning, info, question
     * @param {boolean} closeOthers Close other messages before displaying this one.
     */

    displayAlert(msg, timeMs, type = 'info', closeOthers = false) {
        const options = {
            showOnlyTheLastOne: closeOthers,
        };
        if (timeMs !== undefined) {
            options.timeout = timeMs;
        }
        notifyTypes[type](msg, options);
    },

    /**
     * Teleport method to move this user's camera to the front of another user's camera.
     * @param {string} userId Camera object id of the target user
     */
    moveToFrontOfCamera(userId) {
        const { el } = this;

        const { sceneEl } = el;
        const cameraEl = sceneEl.camera.el;

        // console.log('Move to near camera:', userId);

        const toCam = sceneEl.querySelector(`[id='${userId}']`);

        if (!toCam) {
            // TODO: find a better way to do this
            // when we jump to a scene, the "to" user needs to move for us to be able to find his camera
            console.error('Could not find destination user', userId);
            return;
        }

        if (!cameraEl) {
            console.error('Could not find our camera');
            return;
        }

        const direction = new THREE.Vector3();
        toCam.object3D.getWorldDirection(direction);
        const distance = this.arena.userTeleportDistance ? this.arena.userTeleportDistance : 2; // distance to put you
        cameraEl.object3D.position.copy(toCam.object3D.position.clone()).add(direction.multiplyScalar(-distance));
        cameraEl.object3D.position.y = toCam.object3D.position.y;
        // Reset navMesh data
        cameraEl.components['wasd-controls'].resetNav();
        cameraEl.components['press-and-move'].resetNav();
        // rotate our camera to face the other user
        cameraEl.components['look-controls'].yawObject.rotation.y = Math.atan2(
            cameraEl.object3D.position.x - toCam.object3D.position.x,
            cameraEl.object3D.position.z - toCam.object3D.position.z
        );
    },
});
