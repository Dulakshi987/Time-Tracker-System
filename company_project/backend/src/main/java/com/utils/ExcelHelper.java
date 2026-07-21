package com.utils;

import com.entity.Document;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.InputStream;

import java.time.LocalDate;
import java.time.LocalTime;

import java.util.ArrayList;
import java.util.List;

public class ExcelHelper {

    // Reused for every cell so the value comes back exactly as Excel
    // displays it, regardless of underlying cell type.
    private static final DataFormatter FORMATTER = new DataFormatter();

    public static List<Document> excelToDocuments(InputStream is) {

        List<Document> docs = new ArrayList<>();

        try {
            Workbook workbook = new XSSFWorkbook(is);
            Sheet sheet = workbook.getSheetAt(0);

            for (Row row : sheet) {

                // SKIP HEADER
                if (row.getRowNum() == 0) {
                    continue;
                }

                // skip fully blank rows
                if (isRowEmpty(row)) {
                    continue;
                }

                Document doc = new Document();

                // Column order — must match the template header order:
                // Job Type, Division, Job WBS, Reservation No, Customer Name,
                // Entered By, Requested By, Vehicle No, SAP Issue Line No,
                // Request Date, Request Time

                // COLUMN 0 — Division
                doc.setDivisionNo(getCellValue(row.getCell(1)));

                // COLUMN 1 — Job Type
                doc.setJobType(getCellValue(row.getCell(0)));

            

                // COLUMN 2 — Job WBS
                doc.setJobWBS(getCellValue(row.getCell(2)));

                // COLUMN 3 — Reservation No
                doc.setReservationNo(getCellValue(row.getCell(3)));

                // COLUMN 4 — Customer Name
                doc.setCustomerName(getCellValue(row.getCell(4)));

                // COLUMN 5 — Entered By
                doc.setEnteredBy(getCellValue(row.getCell(5)));

                // COLUMN 6 — Requested By
                doc.setRequestedBy(getCellValue(row.getCell(6)));

                // COLUMN 7 — Vehicle No
                doc.setVehicleNo(getCellValue(row.getCell(7)));

                // COLUMN 8 — SAP Issue Line No
                doc.setSapIssueLineNo(getCellValue(row.getCell(8)));

                // COLUMN 9 & 10 — Request Date / Request Time from the
                // sheet itself. If you'd rather always stamp "now" instead
                // of trusting the sheet, swap these two lines back to
                // LocalDate.now()/LocalTime.now() as before.
                String excelDate = getCellValue(row.getCell(9));
                String excelTime = getCellValue(row.getCell(10));

                doc.setRequestDate(
                        excelDate.isEmpty() ? LocalDate.now().toString() : excelDate
                );
                doc.setRequestTime(
                        excelTime.isEmpty()
                                ? LocalTime.now().toString().substring(0, 5)
                                : excelTime
                );

                doc.setStatus("Print Pending");

                docs.add(doc);
            }

            workbook.close();

        } catch (Exception e) {
            e.printStackTrace();
        }

        return docs;
    }

    private static String getCellValue(Cell cell) {
        if (cell == null) {
            return "";
        }
        return FORMATTER.formatCellValue(cell).trim();
    }

    private static boolean isRowEmpty(Row row) {
        for (int c = row.getFirstCellNum(); c < row.getLastCellNum(); c++) {
            Cell cell = row.getCell(c);
            if (cell != null
                    && cell.getCellType() != CellType.BLANK
                    && !getCellValue(cell).isEmpty()) {
                return false;
            }
        }
        return true;
    }
}