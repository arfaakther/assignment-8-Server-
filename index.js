import express from "express"; 
const app = express(); 
const port = 8000;

import "dotenv/config";
import { ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import cors from "cors"; 
import { MongoClient } from "mongodb"; 
const client = new MongoClient(process.env.MONGODB_URI); 
export async function connectToMongoDB() { 
try { 
await client.connect(); 
console.log("You successfully connected to MongoDB!"); 
return client; 
} catch (err) { 
console.dir(err); 
} 
} 

app.use(cors());
app.use(express.json());

const mongoClient = await connectToMongoDB();
const db = mongoClient.db("charity");
const eventsCollection = db.collection("events");

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }
  const token = authHeader.split(" ")[1];
  console.log("server side",authHeader)
  if (!token) {
    return res.status(401).send({ msg: "Unauthorized!" });
  }

  const JWKS = createRemoteJWKSet(
    new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
  );

  try {
    const { payload } = await jwtVerify(token, JWKS);
    next();
  } catch (error) {
    return res.status(500).send({ msg: "Server Error!" });
  }
};

// all data get
app.post("/events", async (req, res) => {
  const data = req.body;
  const result = await eventsCollection.insertOne(data);
  console.log(result);
  res.send(result);
});

app.get("/events",verifyToken, async (req, res) => { 
    const event = await eventsCollection.find({}).toArray();
 res.send(event);

}); 
app.get("/", async (req, res) => { 
    
 res.send("server running");

}); 

// single data get

app.get("/events/:id", verifyToken, async (req, res) => {
  const id = req.params.id;

  const event = await eventsCollection.findOne({
    _id: new ObjectId(id),
  });

  res.send(event);
});

// get by name



// update data
app.patch("/events/:id", async (req, res) => {
  const id = req.params.id;
  const data = req.body;

  const result = await eventsCollection.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: data,
    }
  );

  res.send(result);
});

// delete data

app.delete("/events/:id", async (req, res) => {
  const id = req.params.id;

  const result = await eventsCollection.deleteOne({
    _id: new ObjectId(id),
  });

  res.send(result);
});


app.listen(port, () => { 
console.log(`Example app listening on port ${port}`); 
}); 