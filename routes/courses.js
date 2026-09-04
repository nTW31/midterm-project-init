const { pool } = require("../db");
const { redisClient } = require("../cache");
const { authMiddleware, requireRole } = require("../middlewares/auth");

const ALLOWED_SORT_FIELDS = ["course_name", "credit", "created_at"];

module.exports = function registerCourseRoutes(v1Router, v2Router) {
  v1Router.get("/courses", async (req, res, next) => {
    try {
      const cacheKey = "courses:all";
      // ข้อสอบข้อที่ 1 (Redis Caching): 1. ตรวจสอบใน Redis ก่อน
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        // ข้อสอบข้อที่ 1 (Redis Caching): ถ้าเจอ (Cache Hit) ตอบกลับทันที
        return res.status(200).json(JSON.parse(cached));
      }
      // ข้อสอบข้อที่ 1 (Redis Caching): 2. ถ้าไม่เจอ (Cache Miss) ค่อยดึงจาก MySQL
      const [rows] = await pool.query("SELECT * FROM courses ORDER BY id");
      const responseData = { message: "สำเร็จ", data: rows };
      // ข้อสอบข้อที่ 1 (Redis Caching): 3. เก็บลง Redis ตั้งอายุไว้ 60 วินาที
      await redisClient.setEx(cacheKey, 60, JSON.stringify(responseData));
      res.status(200).json(responseData);
    } catch (err) {
      next(err);
    }
  });

  v1Router.post(
    "/courses",
    authMiddleware, //ข้อสอบข้อที่ 1 (JWT Auth + RBAC) : เช็ก Token ก่อน (ถ้าไม่ผ่านจะตอบ 401)
    requireRole("admin"), //ข้อสอบข้อที่ 1 (JWT Auth + RBAC) : เช็ก Role (ถ้าไม่ผ่านจะตอบ 403)
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
        //ข้อสอบข้อที่ 1 (Redis Caching) : 4. ลบแคชทิ้ง เพื่อให้คนที่เรียก GET ครั้งต่อไปได้ข้อมูลใหม่ล่าสุด
        await redisClient.del("courses:all");
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
