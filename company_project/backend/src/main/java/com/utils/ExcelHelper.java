package com.utils;

import com.entity.Document;

import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import java.io.InputStream;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class ExcelHelper {

    // Reused for every cell so the value comes back exactly as Excel
    // displays it, regardless of underlying cell type.
    private static final DataFormatter FORMATTER = new DataFormatter();

    // Formats we'll try when the date arrives as plain text instead of
    // a real Excel date value.
    private static final List<DateTimeFormatter> DATE_INPUT_FORMATS = Arrays.asList(
            DateTimeFormatter.ofPattern("yyyy-MM-dd"),
            DateTimeFormatter.ofPattern("dd/MM/yyyy"),
            DateTimeFormatter.ofPattern("MM/dd/yyyy"),
            DateTimeFormatter.ofPattern("dd-MM-yyyy"),
            DateTimeFormatter.ofPattern("d/M/yyyy"),
            DateTimeFormatter.ofPattern("M/d/yyyy")
    );

    // Formats we'll try when the time arrives as plain text instead of
    // a real Excel time value.
    private static final List<DateTimeFormatter> TIME_INPUT_FORMATS = Arrays.asList(
            DateTimeFormatter.ofPattern("HH:mm"),
            DateTimeFormatter.ofPattern("HH:mm:ss"),
            DateTimeFormatter.ofPattern("H:mm"),
            DateTimeFormatter.ofPattern("hh:mm a"),   // 02:30 PM
            DateTimeFormatter.ofPattern("h:mm a"),    // 2:30 PM
            DateTimeFormatter.ofPattern("hh:mm:ss a")
    );

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
                // Division, Job Type, Job WBS, Reservation No, Customer Name,
                // Entered By, Requested By, Vehicle No, SAP Issue Line No,
                // Request Date, Request Time

                // COLUMN 0 — Division
                doc.setDivisionNo(getCellValue(row.getCell(0)));

                // COLUMN 1 — Job Type
                doc.setJobType(getCellValue(row.getCell(1)));

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

                // COLUMN 9 — Request Date, always normalized to yyyy-MM-dd
                String excelDate = getDateCellValue(row.getCell(9));

                // COLUMN 10 — Request Time, always normalized to 24-hour
                // digital HH:mm (e.g. 14:05), regardless of how it was
                // typed or formatted in Excel (12-hour AM/PM etc.)
                String excelTime = getTimeCellValue(row.getCell(10));

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

    /**
     * Always returns the date as yyyy-MM-dd (e.g. 2026-07-23), no matter
     * what format the Excel cell was typed in, or how it displays.
     */
    private static String getDateCellValue(Cell cell) {
        if (cell == null) {
            return "";
        }

        // Case 1: Excel stored it as a real date value
        if (cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
            LocalDate date = cell.getLocalDateTimeCellValue().toLocalDate();
            return date.format(DateTimeFormatter.ISO_LOCAL_DATE); // yyyy-MM-dd
        }

        // Case 2: it's plain text — try known formats one by one
        String raw = FORMATTER.formatCellValue(cell).trim();
        if (raw.isEmpty()) {
            return "";
        }

        for (DateTimeFormatter fmt : DATE_INPUT_FORMATS) {
            try {
                LocalDate parsed = LocalDate.parse(raw, fmt);
                return parsed.format(DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException ignored) {
                // try the next format
            }
        }

        // Couldn't understand it — return as-is so it's visible for correction
        return raw;
    }

    /**
     * Always returns the time as a 24-hour digital HH:mm string
     * (e.g. 09:05, 14:30), no matter whether the Excel cell held a real
     * time value, a 12-hour AM/PM value, or plain text.
     */
    private static String getTimeCellValue(Cell cell) {
        if (cell == null) {
            return "";
        }

        // Case 1: Excel stored it as a real time/date-time value
        if (cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
            LocalTime time = cell.getLocalDateTimeCellValue().toLocalTime();
            return time.format(DateTimeFormatter.ofPattern("HH:mm"));
        }

        // Case 2: it's plain text — try known formats one by one
        String raw = FORMATTER.formatCellValue(cell).trim();
        if (raw.isEmpty()) {
            return "";
        }

        for (DateTimeFormatter fmt : TIME_INPUT_FORMATS) {
            try {
                LocalTime parsed = LocalTime.parse(raw.toUpperCase(), fmt);
                return parsed.format(DateTimeFormatter.ofPattern("HH:mm"));
            } catch (DateTimeParseException ignored) {
                // try the next format
            }
        }

        // Couldn't understand it — return as-is so it's visible for correction
        return raw;
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