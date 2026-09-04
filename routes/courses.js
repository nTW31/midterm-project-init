const { pool } = require("../db");
const { redisClient } = require("../cache");
const { authMiddleware, requireRole } = require("../middlewares/auth");

const ALLOWED_SORT_FIELDS = ["course_name", "credit", "created_at"];

module.exports = function registerCourseRoutes(v1Router, v2Router) {
  v1Router.get("/courses", async (req, res, next) => {
    try {
      // =========================================================================
      // ข้อสอบข้อที่ 2 : Pagination / Filtering / Sorting
      // =========================================================================
      // 1. Pagination: รับค่า page และ limit พร้อมคำนวณ offset
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (page - 1) * limit;
      // 2. Sorting: ตรวจสอบ Allowlist ป้องกัน SQL Injection
      const sort = req.query.sort;
      const sortField = ALLOWED_SORT_FIELDS.includes(sort) ? sort : "id";
      const order = (req.query.order || "ASC").toUpperCase();
      const sortOrder = order === "DESC" ? "DESC" : "ASC";
      // 3. Filtering: กรองเงื่อนไขแบบปลอดภัยด้วย Parameterized Query
      const { minCredit, search } = req.query;
      const conditions = [];
      const params = [];
      if (minCredit !== undefined && minCredit !== "") {
        conditions.push("credit >= ?");
        params.push(Number(minCredit));
      }
      if (search) {
        conditions.push("course_name LIKE ?");
        params.push(`%${search}%`);
      }
      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      // 4. Redis Cache Key ผูกตามเงื่อนไขการค้นหา
      const cacheKey = `courses:list:${page}:${limit}:${sortField}:${sortOrder}:${minCredit || ""}:${search || ""}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.status(200).json(JSON.parse(cached));
      }
      // 5. Query นับจำนวนทั้งหมดเพื่อคำนวณ metadata หน้า
      const countSql = `SELECT COUNT(*) AS total FROM courses ${whereClause}`;
      const [[{ total }]] = await pool.query(countSql, params);
      const totalPages = Math.ceil(total / limit);
      // 6. Query ดึงข้อมูลตามหน้าและการเรียงลำดับ
      const dataSql = `SELECT * FROM courses ${whereClause} ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`;
      const [rows] = await pool.query(dataSql, [...params, limit, offset]);
      const responseData = {
        message: "สำเร็จ",
        data: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      };
      // 7. เซฟลง Redis แคชไว้ 60 วินาที
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
        // ล้างแคชรายการวิชาทั้งหมดที่มีการแบ่งหน้า/ค้นหาไว้
        const keys = await redisClient.keys("courses:*");
        if (keys.length > 0) {
          await redisClient.del(keys);
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
