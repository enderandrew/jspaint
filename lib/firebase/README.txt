Firebase JavaScript SDK 13.1.0 (https://github.com/firebase/firebase-js-sdk), Apache-2.0, see LICENSE.
Just the two "compat" browser builds multi-user mode needs (src/sessions.js): the app and the Realtime Database.
They define a global `firebase` with the classic namespaced API (firebase.database().ref()...).
