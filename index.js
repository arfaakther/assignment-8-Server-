
import express from "express";
import "dotenv/config";
import { ObjectId, MongoClient } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import cors from "cors";

const app = express();
const port = 8000;

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

app.use(cors());
app.use(express.json());

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("charity");

const eventsCollection = db.collection("events");
const joinedEventsCollection = db.collection("joinedEvents");

// Prevent the same user from joining the same event twice
await joinedEventsCollection.createIndex(
  { eventId: 1, userId: 1 },
  { unique: true }
);

// Verify user token
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }

  const token = authHeader.split(" ")[1];

  const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
  );

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.user = payload;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).send({ msg: "Invalid token!" });
  }
};

// Home
app.get("/", (req, res) => {
  res.send("Server running");
});

// Create event (Protected)
app.post("/events", verifyToken, async (req, res) => {
  try {
    const data = req.body;

    const eventData = {
      ...data,
      creatorId: req.user.sub,
      organizerEmail: req.user.email || "",
      createdAt: new Date(),
    };

    const result = await eventsCollection.insertOne(eventData);

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to create event" });
  }
});

// Get all events (Public)
app.get("/events", async (req, res) => {
  try {
    const events = await eventsCollection.find({}).toArray();
    res.send(events);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch events" });
  }
});

// Get single event (Public)
app.get("/events/:id",verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event ID" });
    }

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({ message: "Event not found" });
    }

    res.send(event);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch event" });
  }
});

// Join event (Protected)
app.post("/events/:id/join", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event ID" });
    }

    const userId = req.user.sub;

    if (!userId) {
      return res.status(401).send({ message: "User ID not found in token" });
    }

    const event = await eventsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({ message: "Event not found" });
    }

    await joinedEventsCollection.updateOne(
      {
        eventId: new ObjectId(id),
        userId: userId,
      },
      {
        $setOnInsert: {
          eventId: new ObjectId(id),
          userId: userId,
          userEmail: req.user.email || "",
          joinedAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.send({
      message: "Successfully joined event",
      joined: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to join event" });
  }
});

// Check joined status (Protected)
app.get("/events/:id/join", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event ID" });
    }

    const joined = await joinedEventsCollection.findOne({
      eventId: new ObjectId(id),
      userId: req.user.sub,
    });

    res.send({ joined: !!joined });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to check joined status" });
  }
});

// Get joined events (Protected)
app.get("/joined-events", verifyToken, async (req, res) => {
  try {
    const joinedEvents = await joinedEventsCollection
      .aggregate([
        {
          $match: {
            userId: req.user.sub,
          },
        },
        {
          $lookup: {
            from: "events",
            localField: "eventId",
            foreignField: "_id",
            as: "event",
          },
        },
        {
          $unwind: "$event",
        },
        {
          $replaceRoot: {
            newRoot: "$event",
          },
        },
      ])
      .toArray();

    res.send(joinedEvents);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch joined events" });
  }
});

// Get only my created events (Protected)
app.get("/my-events", verifyToken, async (req, res) => {
  try {
    const events = await eventsCollection
      .find({ creatorId: req.user.sub })
      .toArray();

    res.send(events);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to fetch your events" });
  }
});

// Update only my own event (Protected)
app.patch("/events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event ID" });
    }

    const { _id, creatorId, createdAt, ...updateData } = req.body;

    const result = await eventsCollection.updateOne(
      {
        _id: new ObjectId(id),
        creatorId: req.user.sub,
      },
      {
        $set: updateData,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Event not found or you don't own this event",
      });
    }

    res.send({ message: "Event updated successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to update event" });
  }
});

// Delete only my own event (Protected)
app.delete("/events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event ID" });
    }

    const result = await eventsCollection.deleteOne({
      _id: new ObjectId(id),
      creatorId: req.user.sub,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Event not found or you don't own this event",
      });
    }

    res.send({ message: "Event deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to delete event" });
  }
});

// Leave event (Protected)
app.delete("/events/:id/join", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event ID" });
    }

    const result = await joinedEventsCollection.deleteOne({
      eventId: new ObjectId(id),
      userId: req.user.sub,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "You have not joined this event",
      });
    }

    res.send({
      message: "You left this event successfully",
      joined: false,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to leave event" });
  }
});

// Get 6 upcoming events (Public - No authentication required)
app.get("/upcoming-events", async (req, res) => {
  try {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const events = await eventsCollection
      .find({
        date: { $gte: today },
      })
      .sort({ date: 1 })
      .limit(6)
      .toArray();

    res.send(events);
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Failed to fetch upcoming events",
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

