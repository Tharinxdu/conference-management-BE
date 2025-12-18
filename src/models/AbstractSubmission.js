const mongoose = require("mongoose");

const AttachmentSchema = new mongoose.Schema(
    {
        originalName: { type: String, required: true },
        storedName: { type: String, required: true },
        mimeType: { type: String, required: true },
        size: { type: Number, required: true },
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: true }
);

const AbstractSubmissionSchema = new mongoose.Schema(
    {
        // Links
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        presentingAuthorProfile: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PresentingAuthorProfile",
            required: true,
            index: true,
        },

        // Presenter Information
        presentingAuthorName: { type: String, required: true, trim: true, maxlength: 160 },
        correspondingAuthorName: { type: String, required: true, trim: true, maxlength: 160 },
        correspondingAuthorEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },

        // Abstract Details
        abstractTitle: { type: String, required: true, trim: true, maxlength: 250 },

        preferredPresentationTypes: {
            type: [String],
            required: true,
            enum: ["ORAL", "POSTER", "EITHER"],
        },

        scientificCategories: {
            type: [String],
            required: true,
            enum: [
                "ACUTE_STROKE_MANAGEMENT",
                "STROKE_PREVENTION",
                "NEUROIMAGING_AND_DIAGNOSTICS",
                "REHABILITATION_AND_RECOVERY",
                "BASIC_AND_TRANSLATIONAL_RESEARCH",
                "HEALTH_SYSTEMS_AND_POLICY",
                "OTHER",
            ],
        },
        otherCategoryText: { type: String, trim: true, maxlength: 120 },

        // Abstract Content
        abstractText: { type: String, required: true, trim: true }, // enforce 300 words in service
        keywords: { type: [String], required: true }, // enforce <= 5 in service

        // Co-authors
        coAuthorsRaw: { type: String, default: "" }, // store as raw lines
        coAuthors: [
            {
                fullName: String,
                institution: String,
                country: String,
                email: String,
                rawLine: String,
            },
        ],

        // Declarations (required only on CREATE)
        declarations: {
            originalWork: { type: Boolean, default: false },
            authorsApproved: { type: Boolean, default: false },
            agreeProceedings: { type: Boolean, default: false },
            acceptedAt: { type: Date, default: null },
        },

        // Files
        attachments: { type: [AttachmentSchema], default: [] },

        // Status
        status: {
            type: String,
            enum: ["submitted", "updated", "approved", "rejected"],
            default: "submitted",
            index: true,
        },
        submissionEmailSentAt: { type: Date, default: null },
        submittedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

AbstractSubmissionSchema.index({ owner: 1, createdAt: -1 });

module.exports = mongoose.model("AbstractSubmission", AbstractSubmissionSchema);
