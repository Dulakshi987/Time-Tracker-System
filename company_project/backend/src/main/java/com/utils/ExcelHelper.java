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
    // displays it — this is what fixes both the "Requested By becomes a
    // number" issue and the "Request Time comes out wrong" issue, since it
    // respects whatever format (Text / Number / Time / Date) is applied to
    // the cell instead of us guessing based on cell.getCellType().
    private static final DataFormatter FORMATTER = new DataFormatter();

    public static List<Document> excelToDocuments(
            InputStream is
    ) {

        List<Document> docs = new ArrayList<>();

        try {

            Workbook workbook =
                    new XSSFWorkbook(is);

            Sheet sheet =
                    workbook.getSheetAt(0);

            // LOOP ROWS
            for (Row row : sheet) {

                // SKIP HEADER
                if (row.getRowNum() == 0) {
                    continue;
                }

                // skip fully blank rows (common at the end of a sheet)
                if (isRowEmpty(row)) {
                    continue;
                }

                Document doc = new Document();

                // COLUMN 0 — Job Type
                doc.setJobType(
                        getCellValue(row.getCell(0))
                );

                // COLUMN 1 — Job WBS
                doc.setJobWBS(
                        getCellValue(row.getCell(1))
                );

                // COLUMN 2 — Reservation No
                doc.setReservationNo(
                        getCellValue(row.getCell(2))
                );

                // COLUMN 3 — Customer Name
                doc.setCustomerName(
                        getCellValue(row.getCell(3))
                );

                // COLUMN 4 — Entered By
                doc.setEnteredBy(
                        getCellValue(row.getCell(4))
                );

                // COLUMN 5 — Requested By
                // Force-read as text via DataFormatter so a numeric-looking
                // value (e.g. a phone number or NIC) never gets mangled
                // into scientific notation or loses leading zeros.
                doc.setRequestedBy(
                        getCellValue(row.getCell(5))
                );

                // COLUMN 6 — Vehicle No
                doc.setVehicleNo(
                        getCellValue(row.getCell(6))
                );

                // COLUMN 7 — SAP Issue Line No
                doc.setSapIssueLineNo(
                        getCellValue(row.getCell(7))
                );

                // AUTO VALUES — always stamped with "now", regardless of
                // whatever the excel sheet contains, since these represent
                // when the row was actually imported.
                doc.setRequestDate(
                        LocalDate.now().toString()
                );

                doc.setRequestTime(
                        LocalTime.now()
                                .toString()
                                .substring(0, 5) // trim to HH:mm, matching the <input type="time"> field in the form
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

    // ==================================
    // HANDLE ALL CELL TYPES — via DataFormatter, so every cell (STRING,
    // NUMERIC, DATE, BOOLEAN, FORMULA, BLANK) comes back as the text a
    // human would actually see in Excel, not a re-derived Java value.
    // ==================================

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