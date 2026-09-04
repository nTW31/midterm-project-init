const { pool } = require("../db");
const { redisClient } = require("../cache");
const { authMiddleware, requireRole } = require("../middlewares/auth");

const ALLOWED_SORT_FIELDS = ["course_name", "credit", "created_at"];

module.exports = function registerCourseRoutes(v1Router, v2Router) {
  v1Router.get("/courses", async (req, res, next) => {
    try {
      const [rows] = await pool.query("SELECT * FROM courses ORDER BY id");
      res.status(200).json({ message: "สำเร็จ", data: rows });
    } catch (err) {
      next(err);
    }
  });
  //ข้อสอบข้อที่ 1 (JWT Auth + RBAC)
  v1Router.post(
    "/courses",
    authMiddleware, // เช็ก Token ก่อน (ถ้าไม่ผ่านจะตอบ 401)
    requireRole("admin"), // เช็ก Role (ถ้าไม่ผ่านจะตอบ 403)
    async (req, res, next) => {
      const { course_name, credit, prerequisites = [] } = req.body;
      try {
        const [result] = await pool.query(
          "INSERT INTO courses (course_name, credit) VALUES (?, ?)",
          [course_name, credit],
        );
        const courseId = result.insertId;
        for (const prereqId of prerequisites) {
          await pool.query(
            "INSERT INTO course_prerequisites (course_id, prereq_course_id) VALUES (?, ?)",
            [courseId, prereqId],
          );
        }
        res
          .status(201)
          .json({ message: "เพิ่มข้อมูลสำเร็จ", data: { id: courseId } });
      } catch (err) {
        next(err);
      }
    },
  );

  registerCourseRoutes.ALLOWED_SORT_FIELDS = ALLOWED_SORT_FIELDS;
};
