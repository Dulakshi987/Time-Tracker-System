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

                Document doc = new Document();

                // COLUMN 0
                doc.setJobType(
                        getCellValue(row.getCell(0))
                );

                // COLUMN 1
                doc.setJobWBS(
                        getCellValue(row.getCell(1))
                );

                // COLUMN 2
                doc.setReservationNo(
                        getCellValue(row.getCell(2))
                );

                // COLUMN 3
                doc.setCustomerName(
                        getCellValue(row.getCell(3))
                );

                // COLUMN 4
                doc.setEnteredBy(
                        getCellValue(row.getCell(4))
                );

                // COLUMN 5
                doc.setRequestDate(
                        getCellValue(row.getCell(5)));

                // COLUMN 6
                doc.setRequestTime(
                        getCellValue(row.getCell(6)));

                // AUTO VALUES
                doc.setRequestDate(
                        LocalDate.now().toString()
                );

                doc.setRequestTime(
                        LocalTime.now().toString()
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
    // HANDLE ALL CELL TYPES
    // ==================================

    private static String getCellValue(
            Cell cell
    ) {

        if (cell == null) {
            return "";
        }

        switch (cell.getCellType()) {

            case STRING:
                return cell.getStringCellValue();

            case NUMERIC:
                return String.valueOf(
                        (long) cell.getNumericCellValue()
                );

            case BOOLEAN:
                return String.valueOf(
                        cell.getBooleanCellValue()
                );

            default:
                return "";
        }
    }
}