import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type VocSummaryRow = {
  voc_no: string;
  cc_code: string | null;
  desc: string | null;
  status: string;
  cc_maping: string | null;
  detail: string | null;
  created_at: Date | null;
};

/**
 * Equivalent of:
 * WHERE vm.voc_no LIKE 'C%'
 */
export async function getVocSummaryByPrefix(prefix = "C") {
  const like = `${prefix}%`;

  return await prisma.$queryRaw<VocSummaryRow[]>(Prisma.sql`
    SELECT
      vm.voc_no,
      vm2.cc_code,
      CONCAT_WS(
        ' > ',
        vm2.request_type_name,
        vm2.topic_name,
        vm2.issue_name,
        vm2.sub_issue_name
      ) AS "desc",
      vm.status,
      vs.cc_maping,
      vt.detail,
      vt.created_at
    FROM public.voc_master AS vm
    LEFT JOIN public.voc_detail AS vd
      ON vm.id = vd.voc_master_id
    LEFT JOIN public.voc_mapping AS vm2
      ON vm.request_type = vm2.request_type_id
     AND vm.topic = vm2.topic_id
     AND vm.issue = vm2.issue_id
     AND vm.sub_issue = vm2.sub_issue_id
    LEFT JOIN public.voc_status AS vs
      ON vs.status_en = vm.status
    LEFT JOIN (
      SELECT DISTINCT ON (voc_master_id)
        voc_master_id,
        detail,
        created_at
      FROM public.voc_tracking
      ORDER BY voc_master_id, created_at DESC
    ) vt
      ON vt.voc_master_id = vm.id
    WHERE vm.voc_no LIKE ${like};
  `);
}

