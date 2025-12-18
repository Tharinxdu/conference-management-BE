const mongoose = require("mongoose");

const PresentingAuthorProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // 1 profile per user
      index: true,
    },

    // Required fields
    title: {
      type: String,
      enum: ["Dr", "Prof", "Mr", "Ms", "Other"],
      required: true,
      trim: true,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, lowercase: true, trim: true }, // from User
    country: { type: String, required: true, trim: true, maxlength: 120 },

    // Optional fields
    affiliation: { type: String, trim: true, maxlength: 200 },
    department: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 120 },
    designation: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PresentingAuthorProfile", PresentingAuthorProfileSchema);
