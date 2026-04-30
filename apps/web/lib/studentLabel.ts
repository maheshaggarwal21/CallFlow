export type StudentDisplay = {
  label: string;
  isNew: boolean;      // real number, not in students DB
  isUnknown: boolean;  // no caller ID / private number
};

export function getStudentDisplay(
  callerPhone: string | null,
  studentName: string | null
): StudentDisplay {
  if (studentName) {
    return { label: studentName, isNew: false, isUnknown: false };
  }
  if (!callerPhone || callerPhone === "Unknown") {
    return { label: "Unknown", isNew: false, isUnknown: true };
  }
  return { label: "New", isNew: true, isUnknown: false };
}
