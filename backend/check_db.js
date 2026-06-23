const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const ChatSession = require('./models/ChatSession');

async function run() {
  const uri = process.env.MONGODB_URI;
  console.log('Connecting to', uri.slice(0, 30) + '...');
  await mongoose.connect(uri);
  console.log('Connected.');

  const session = await ChatSession.findOne({ sessionId: 'd2e4a426-2af7-4aa7-8e00-336a932bb1c7' });
  console.log('Session messages count:', session ? session.messages.length : 'Not found');
  if (session) {
    console.log(JSON.stringify(session.messages, null, 2));
  }
  await mongoose.disconnect();
}

run().catch(console.error);
