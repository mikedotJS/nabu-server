const WebSocket = require("ws");
require("dotenv").config();

const PORT = process.env.PORT;

class Server {
  constructor(port) {
    this.port = port;
    this.clients = [];
    this.channels = {};
    this.messageCounter = 1; // Track the message count
    this.messages = [];
  }

  start() {
    const server = new WebSocket.Server({ port: this.port });

    server.on("connection", (socket) => {
      const client = this.createClient(socket);
      this.clients.push(client);

      socket.on("message", (data) => {
        const message = data.toString().trim();

        if (client.username === null) {
          this.handleUsername(client, message);
        } else {
          this.handleMessage(client, message);
        }
      });

      socket.on("close", () => {
        this.handleDisconnect(client);
      });

      socket.on("error", (error) => {
        console.log(`Error: ${error}`);
      });
    });

    console.log(`Server is listening on port ${this.port}`);
  }

  createClient(socket) {
    return {
      socket,
      username: null,
      channel: null,
      lastMessage: null,
    };
  }

  handleUsername(client, username) {
    const trimmedUsername = username.trim();

    if (this.isUsernameTaken(trimmedUsername)) {
      client.socket.send(
        "Username is already taken. Please choose a different username.\n"
      );
      return;
    }

    client.username = trimmedUsername;
    client.socket.send(`Welcome, ${client.username}! You are now connected.\n`);
    this.sendAvailableCommands(client);
  }

  sendAvailableCommands(client) {
    const commands = [
      "/join <channel> - Join a channel",
      "/leave <channel> - Leave a channel",
      "/pm <recipient> <message> - Send a private message",
      "/reply <message> or /r <message> - Reply to the last private message received",
      "/react <emoji> - React to a message with an emoji",
      "/channels - List all available channels",
      "/quit - Disconnect from the server",
    ];

    client.socket.send("Available commands:\n");
    commands.forEach((command) => {
      client.socket.send(`- ${command}\n`);
    });

    client.socket.send("Enter a command: ");
  }

  isUsernameTaken(username) {
    return this.clients.some((client) => client.username === username);
  }

  handleMessage(client, message) {
    const [command, ...args] = message.split(" ");

    switch (command) {
      case "/join":
        this.handleJoin(client, args[0]);
        break;
      case "/leave":
        this.handleLeave(client);
        break;
      case "/pm":
        this.handlePrivateMessage(client, args[0], args.slice(1).join(" "));
        break;
      case "/reply":
      case "/r":
        this.handleReply(client, args.join(" "));
        break;
      case "/react":
        this.handleReaction(client, args[0], args[1]);
        break;
      case "/channels":
        this.handleChannels(client);
        break;
      case "/quit":
        this.handleQuit(client);
        break;
      default:
        this.handleChannelMessage(client, message);
        break;
    }
  }

  handleJoin(client, channelName) {
    if (client.channel) {
      client.socket.send(`You are already in the ${client.channel} channel.\n`);
      return;
    }

    if (!this.channels[channelName]) {
      this.channels[channelName] = [];
    }

    client.channel = channelName;
    this.channels[channelName].push(client);

    client.socket.send(`You joined the channel: ${channelName}\n`);
    client.socket.send(
      `To leave the channel, use the command: /leave ${channelName}\n`
    );

    console.log(`User ${client.username} joined the ${channelName} channel`);
  }

  handleLeave(client) {
    if (!client.channel) {
      client.socket.send("You are not in any channel.\n");
      return;
    }

    const channelClients = this.channels[client.channel];
    const index = channelClients.indexOf(client);
    if (index !== -1) {
      channelClients.splice(index, 1);
    }

    client.socket.send(`You left the channel: ${client.channel}\n`);
    client.socket.send("Enter a command: ");

    console.log(`User ${client.username} left the ${client.channel} channel`);
    client.channel = null;
  }

  handleReply(client, message) {
    if (client.lastMessageSender) {
      this.handlePrivateMessage(client, client.lastMessageSender, message);
    } else {
      client.socket.send("No previous private message sender found.\n");
    }
  }

  findMessageById(messageId) {
    const message = this.messages.find((msg) => msg.id === messageId);
    if (message) {
      return message;
    }
    return null;
  }

  handleReaction(client, messageId, emoji) {
    const message = this.findMessageById(messageId);

    if (!message) {
      client.socket.send(`Message '${messageId}' not found.\n`);
      return;
    }

    const channelClients = this.channels[message.channel];
    if (!channelClients.includes(client)) {
      client.socket.send("You are not in the same channel as the message.\n");
      return;
    }

    if (message.reactions == null) message.reactions = [];

    message.reactions.push({ emoji, username: client.username });

    const reactedMessage = `${message.channel}: [${messageId}] ${message.sender}: ${message.text}`;
    const reactionMessage = `${client.username} reacted with ${emoji} to the message: ${reactedMessage}`;

    // Broadcast the reaction to all clients in the channel
    channelClients.forEach((channelClient) => {
      channelClient.socket.send(`${reactionMessage}\n`);
    });

    console.log(reactionMessage);
  }

  handleQuit(client) {
    client.socket.send("Goodbye! Disconnecting from the server.\n");
    client.socket.close();
    this.removeClient(client);
  }

  getAllMessages() {
    return this.messages;
  }

  generateMessageId() {
    const messageId = this.messageCounter.toString();
    this.messageCounter++;
    return messageId;
  }

  handlePrivateMessage(sender, recipient, message) {
    const recipientClient = this.clients.find(
      (client) => client.username === recipient
    );

    if (!recipientClient) {
      sender.socket.send(`User '${recipient}' not found.\n`);
      return;
    }

    recipientClient.socket.send(`(private) ${sender.username}: ${message}\n`);
    sender.socket.send(`(private) to ${recipient}: ${message}\n`);

    recipientClient.lastMessageSender = sender.username;
    recipientClient.socket.send("Enter a command: ");

    console.log(
      `User ${sender.username} sent a private message to ${recipient}`
    );
  }

  handleChannelMessage(client, message) {
    if (!client.channel) {
      client.socket.send("You are not in any channel. Join a channel first.\n");
      return;
    }

    const channelClients = this.channels[client.channel];

    // Generate a unique message ID
    const messageId = this.generateMessageId();

    // Extract the mentioned usernames from the message
    const mentionedUsernames = message.match(/@(\w+)/g);
    if (mentionedUsernames) {
      mentionedUsernames.forEach((mentionedUsername) => {
        const mentionedClient = channelClients.find(
          (c) => c.username === mentionedUsername.substring(1)
        );
        if (mentionedClient) {
          mentionedClient.socket.send(
            `[MENTION] ${client.username}: ${message}\n`
          );
        }
      });
    }

    // Broadcast the message with the message ID to all clients in the channel
    channelClients.forEach((channelClient) => {
      channelClient.socket.send(
        `${client.channel}: [${messageId}] ${client.username}: ${message}\n`
      );
    });

    client.lastMessage = message;

    // Store the message in the server's messages array
    const messageData = {
      id: messageId,
      sender: client.username,
      channel: client.channel,
      text: message,
    };
    this.messages.push(messageData);

    console.log(
      `User ${client.username} sent a message to the ${client.channel} channel`
    );
  }

  handleDisconnect(client) {
    if (client.username) {
      console.log(`User ${client.username} disconnected`);
      this.removeClient(client);
    }
  }

  removeClient(client) {
    this.clients = this.clients.filter((c) => c !== client);

    if (client.channel) {
      const channelClients = this.channels[client.channel];
      const index = channelClients.indexOf(client);
      if (index !== -1) {
        channelClients.splice(index, 1);
      }
    }
  }

  handleChannels(client) {
    const channelNames = Object.keys(this.channels);

    if (channelNames.length === 0) {
      client.socket.send("No channels available.\n");
    } else {
      client.socket.send("Available channels:\n");
      channelNames.forEach((channelName) => {
        client.socket.send(`- ${channelName}\n`);
      });
    }

    client.socket.send("Enter a command: ");
  }
}

const server = new Server(PORT); // Default port
server.start();
